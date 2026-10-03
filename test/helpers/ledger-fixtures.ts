import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { InlineKeyboardButton, Update } from "grammy/types";
import { afterEach, beforeEach, expect, vi, type MockInstance } from "vitest";
import { capture } from "../../src/capture";
import { core } from "../../src/core";
import { corrections } from "../../src/corrections";
import { createGateway, type Gateway } from "../../src/gateway";
import { ALLOWED_CHAT_ID, MEMBER_A, MEMBER_B } from "./constants";
import { useCleanTables } from "./db";
import { logEntries } from "./scheduler";
import { signedRequest } from "./requests";
import { installTelegramStub, type TelegramCall, type TelegramStub } from "./telegram";
import { callbackUpdate, editedMessageUpdate, messageUpdate } from "./updates";

/**
 * The ledger of the `entry-corrections` preamble, stored through the deployed
 * module list and the Telegram stub, so each test starts from real confirmations:
 *
 * - Ana's message 41, `lunch 250`, at 10:00 on 2026-09-29 in Manila: entry 7, confirmed by 900;
 * - Ana's message 42, `grab 180, groceries 2340 gcash`, a minute later: entries 8 and 9, confirmed by 901;
 * - Ana's message 45, `acai 150`, a minute after that: entry 12, confirmed by 905.
 */

/** 10:00 on Tuesday 2026-09-29 in Manila. */
export const SENT = new Date("2026-09-29T02:00:00.000Z");
/** When the tests act: 10:10 on the same day, after every preamble message. */
export const ACTED = new Date("2026-09-29T02:10:00.000Z");
export const HANDLED_AFTER_MS = 3_000;
export const RETRY_AFTER_MS = 5_000;

export const ANA = MEMBER_A;
export const BEN = MEMBER_B;

export const MESSAGE = { lunch: 41, multi: 42, acai: 45 } as const;
export const CONFIRMATION = { lunch: 900, multi: 901, acai: 905 } as const;
export const ENTRY = { lunch: 7, grab: 8, groceries: 9, acai: 12 } as const;

/** The id of the bot's reply to a command or a later message, unless a test says otherwise. */
export const REPLY_ID = 950;

/** A stored row of `expenses`, as SQL gives it. */
export interface ExpenseRow {
  id: number;
  chat_id: number;
  source_message_id: number;
  item_index: number;
  confirmation_message_id: number | null;
  payer_user_id: number;
  amount_centavos: number;
  currency: string;
  description: string;
  category_id: string;
  category_source: string;
  spent_on: string;
  raw_text: string;
  parser: string;
  check_amount: number;
  created_at: string;
  created_by: number;
  updated_at: string;
  updated_by: number;
  deleted_at: string | null;
  deleted_by: number | null;
  source_edited_at: string | null;
}

/** The payload of an `editMessageText` or `editMessageReplyMarkup` call. */
export interface EditPayload {
  chat_id: number;
  message_id: number;
  text?: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
  link_preview_options?: unknown;
  parse_mode?: unknown;
}

/** The payload of a `sendMessage` call. */
export interface SendPayload {
  chat_id: number;
  text: string;
  reply_parameters?: { message_id?: number; allow_sending_without_reply?: boolean };
  reply_markup?: unknown;
}

export interface Member {
  id: number;
  firstName: string;
  username: string;
}

export interface SendOptions {
  /** The member who sends. Ana by default. */
  from?: Member;
  messageId: number;
  /** When the member sends. The bot handles it a few seconds later. */
  at: Date;
  /** The message id the bot's reply gets. */
  replyId?: number;
  updateId?: number;
}

export interface PressOptions {
  /** The member who presses. Ana by default. */
  from?: Member;
  /** The bot message the button is on. */
  messageId: number;
  updateId?: number;
  /** The message that the pressed message replies to. */
  replyToMessageId?: number;
}

export interface CommandOptions {
  from?: Member;
  messageId?: number;
  updateId?: number;
}

export interface EditOptions {
  from?: Member;
  updateId?: number;
}

export interface DeliverOptions {
  gateway?: Gateway;
  env?: Env;
}

export interface CorrectionsHarness {
  readonly telegram: TelegramStub;
  /** The `console.log` spy, installed for every test. */
  readonly log: MockInstance<typeof console.log>;
  /** The attempt time the gateway reads. */
  now: Date;
  /** A gateway over the deployed module order, core, corrections and capture. */
  gateway(): Gateway;
  /** The update, delivered once through the shared gateway unless another is given. */
  deliver(update: Update, options?: DeliverOptions): Promise<Response>;
  /** The update delivered again after the retry delay, as Telegram does after a failed attempt. */
  redeliver(update: Update, options?: DeliverOptions): Promise<Response>;
  /** A member sends a text message, handled a few seconds later. Returns the ids of its stored entries. */
  sendText(text: string, options: SendOptions): Promise<number[]>;
  /** The update for a press, without delivering it. */
  pressUpdate(data: string, options: PressOptions): Update;
  /** A member presses a button, at the current attempt time. */
  press(data: string, options: PressOptions): Promise<Response>;
  /** The update for a command, sent at the current attempt time, without delivering it. */
  commandUpdate(text: string, options?: CommandOptions): Update;
  /** A member sends a command, at the current attempt time. */
  command(text: string, options?: CommandOptions): Promise<Response>;
  /** A member edits one of their messages to a new text, at the current attempt time. */
  edit(messageId: number, text: string, options?: EditOptions): Promise<Response>;
  /** Stores the preamble's entries 7, 8, 9 and 12 and clears the recorded calls. */
  seedPreamble(): Promise<void>;
  /** The stored row of an entry. */
  entry(id: number): Promise<ExpenseRow>;
  /** Every stored row, by id. */
  entries(): Promise<ExpenseRow[]>;
  /** The edits of a bot message's text, oldest first. */
  textEdits(messageId?: number): EditPayload[];
  /** The edits of a bot message's buttons only, oldest first. */
  buttonEdits(messageId?: number): EditPayload[];
  /** The text of the last accepted text edit of a bot message. */
  lastText(messageId: number): string | undefined;
  /** The buttons of the last accepted text edit of a bot message. */
  lastButtons(messageId: number): InlineKeyboardButton[][] | undefined;
  /** Accepted `sendMessage` calls. */
  sent(): SendPayload[];
  /** The notices that accepted press answers carried, oldest first; `undefined` for an answer with no text. */
  answers(): (string | undefined)[];
  /** The parsed `console.log` entries. */
  logs(): Record<string, unknown>[];
}

/** A button as the confirmation and the grid write it. */
export function button(text: string, data: string): InlineKeyboardButton {
  return { text, callback_data: data };
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function sendResult(messageId: number, at: Date) {
  return {
    message_id: messageId,
    date: seconds(at),
    chat: { id: ALLOWED_CHAT_ID, type: "supergroup" },
    text: "",
  };
}

/** Inserts a placeholder row with this id, so the next stored entry gets the id after it. */
async function placeholder(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO expenses (id, chat_id, source_message_id, item_index, payer_user_id, amount_centavos,
         currency, description, category_id, category_source, spent_on, raw_text, parser, check_amount,
         created_at, created_by, updated_at, updated_by)
       VALUES (?1, 0, ?1, 0, 0, 1, 'PHP', '', 'other', 'default', '2000-01-01', '', 'rules', 0,
         '2000-01-01T00:00:00.000Z', 0, '2000-01-01T00:00:00.000Z', 0)`,
    )
    .bind(id)
    .run();
}

/**
 * Registers the hooks that give each test clean tables, the allowed chat, the
 * Telegram stub and a `console.log` spy, and returns the harness that reads them.
 */
export function useCorrectionsHarness(): CorrectionsHarness {
  useCleanTables(env.DB);

  let telegram: TelegramStub;
  let log: MockInstance<typeof console.log>;
  let shared: Gateway;
  let nextUpdateId = 1;
  const clock = { now: ACTED };

  beforeEach(async () => {
    telegram = installTelegramStub();
    telegram.setResult("sendMessage", sendResult(REPLY_ID, ACTED));
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    clock.now = ACTED;
    nextUpdateId = 1000;
    shared = createGateway({ modules: [core, corrections, capture], now: () => clock.now });
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
      .bind(String(ALLOWED_CHAT_ID), SENT.toISOString())
      .run();
  });

  afterEach(() => {
    telegram.restore();
    log.mockRestore();
  });

  async function deliver(update: Update, options: DeliverOptions = {}): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await (options.gateway ?? shared).fetch(signedRequest(update), options.env ?? env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  function sender(from: Member | undefined) {
    const member = from ?? ANA;
    return { userId: member.id, firstName: member.firstName, username: member.username };
  }

  function editsOf(method: string, messageId: number | undefined): EditPayload[] {
    return telegram
      .callsTo(method)
      .filter((call) => !call.failed)
      .map((call) => call.payload as EditPayload)
      .filter((payload) => messageId === undefined || payload.message_id === messageId);
  }

  const harness: CorrectionsHarness = {
    get telegram() {
      return telegram;
    },
    get log() {
      return log;
    },
    get now() {
      return clock.now;
    },
    set now(value: Date) {
      clock.now = value;
    },
    gateway: () => createGateway({ modules: [core, corrections, capture], now: () => clock.now }),
    deliver,
    async redeliver(update, options) {
      clock.now = new Date(clock.now.getTime() + RETRY_AFTER_MS);
      return deliver(update, options);
    },
    async sendText(text, options) {
      telegram.setResult("sendMessage", sendResult(options.replyId ?? REPLY_ID, options.at));
      const before = clock.now;
      clock.now = new Date(options.at.getTime() + HANDLED_AFTER_MS);
      const response = await deliver(
        messageUpdate({
          text,
          updateId: options.updateId ?? nextUpdateId++,
          messageId: options.messageId,
          date: seconds(options.at),
          ...sender(options.from),
        }),
      );
      clock.now = before;
      telegram.setResult("sendMessage", sendResult(REPLY_ID, before));
      expect(response.status).toBe(200);
      const { results } = await env.DB.prepare(
        "SELECT id FROM expenses WHERE chat_id = ? AND source_message_id = ? ORDER BY item_index",
      )
        .bind(ALLOWED_CHAT_ID, options.messageId)
        .all<{ id: number }>();
      return results.map((row) => row.id);
    },
    pressUpdate(data, options) {
      return callbackUpdate({
        data,
        updateId: options.updateId ?? nextUpdateId++,
        messageId: options.messageId,
        date: seconds(SENT),
        ...(options.replyToMessageId === undefined ? {} : { replyToMessageId: options.replyToMessageId }),
        ...sender(options.from),
      });
    },
    async press(data, options) {
      return deliver(harness.pressUpdate(data, options));
    },
    commandUpdate(text, options = {}) {
      return messageUpdate({
        text,
        updateId: options.updateId ?? nextUpdateId++,
        messageId: options.messageId ?? 60,
        date: seconds(clock.now),
        ...sender(options.from),
      });
    },
    async command(text, options) {
      return deliver(harness.commandUpdate(text, options));
    },
    async edit(messageId, text, options = {}) {
      return deliver(
        editedMessageUpdate({
          text,
          updateId: options.updateId ?? nextUpdateId++,
          messageId,
          date: seconds(SENT),
          editDate: seconds(clock.now),
          ...sender(options.from),
        }),
      );
    },
    async seedPreamble() {
      const minute = 60_000;
      await placeholder(env.DB, ENTRY.lunch - 1);
      await harness.sendText("lunch 250", { messageId: MESSAGE.lunch, at: SENT, replyId: CONFIRMATION.lunch });
      await harness.sendText("grab 180, groceries 2340 gcash", {
        messageId: MESSAGE.multi,
        at: new Date(SENT.getTime() + minute),
        replyId: CONFIRMATION.multi,
      });
      await placeholder(env.DB, ENTRY.acai - 1);
      await harness.sendText("acai 150", {
        messageId: MESSAGE.acai,
        at: new Date(SENT.getTime() + 2 * minute),
        replyId: CONFIRMATION.acai,
      });
      await env.DB.prepare("DELETE FROM expenses WHERE id IN (?, ?)")
        .bind(ENTRY.lunch - 1, ENTRY.acai - 1)
        .run();

      const stored = await harness.entries();
      expect(stored.map((row) => [row.id, row.category_id, row.confirmation_message_id])).toEqual([
        [ENTRY.lunch, "dining", CONFIRMATION.lunch],
        [ENTRY.grab, "transport", CONFIRMATION.multi],
        [ENTRY.groceries, "groceries", CONFIRMATION.multi],
        [ENTRY.acai, "other", CONFIRMATION.acai],
      ]);
      telegram.calls.length = 0;
      log.mockClear();
    },
    async entry(id) {
      const row = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<ExpenseRow>();
      expect(row, `entry ${id}`).not.toBeNull();
      return row as ExpenseRow;
    },
    async entries() {
      const { results } = await env.DB.prepare("SELECT * FROM expenses ORDER BY id").all<ExpenseRow>();
      return results;
    },
    textEdits: (messageId) => editsOf("editMessageText", messageId),
    buttonEdits: (messageId) => editsOf("editMessageReplyMarkup", messageId),
    lastText: (messageId) => editsOf("editMessageText", messageId).at(-1)?.text,
    lastButtons: (messageId) => editsOf("editMessageText", messageId).at(-1)?.reply_markup?.inline_keyboard,
    sent: () =>
      telegram
        .callsTo("sendMessage")
        .filter((call: TelegramCall) => !call.failed)
        .map((call) => call.payload as SendPayload),
    answers: () =>
      telegram
        .callsTo("answerCallbackQuery")
        .filter((call) => !call.failed)
        .map((call) => (call.payload as { text?: string } | undefined)?.text),
    logs: () => logEntries(log),
  };
  return harness;
}
