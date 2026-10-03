import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capture } from "../src/capture";
import { core } from "../src/core";
import { createGateway } from "../src/gateway";
import type { FeatureModule } from "../src/gateway/registry";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { probeModule } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramCall, type TelegramStub } from "./helpers/telegram";
import {
  editedMessageUpdate,
  messageUpdate,
  photoUpdate,
  stickerUpdate,
  voiceUpdate,
} from "./helpers/updates";

/** Ana sends at 10:00 on Tuesday 2026-09-29 in Manila. */
const SENT = new Date("2026-09-29T02:00:00.000Z");
const HANDLED_AFTER_MS = 3_000;
const RETRY_AFTER_MS = 5_000;
const UPDATE_ID = 700;
const MESSAGE_ID = 41;
const CONFIRMATION_ID = 900;

const REJECTED_AMOUNT = "❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.";

interface ExpenseRow {
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
}

interface SendPayload {
  chat_id?: unknown;
  text: string;
  parse_mode?: unknown;
  reply_parameters?: { message_id?: unknown; allow_sending_without_reply?: unknown };
  link_preview_options?: unknown;
  reply_markup?: { inline_keyboard?: unknown };
}

useCleanTables(env.DB);

let telegram: TelegramStub;
let now: Date;

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function handledAfter(sentAt: Date): Date {
  return new Date(sentAt.getTime() + HANDLED_AFTER_MS);
}

beforeEach(async () => {
  telegram = installTelegramStub();
  telegram.setResult("sendMessage", {
    message_id: CONFIRMATION_ID,
    date: seconds(SENT),
    chat: { id: ALLOWED_CHAT_ID, type: "supergroup" },
    text: "",
  });
  now = handledAfter(SENT);
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), SENT.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

function gatewayWith(modules: FeatureModule[] = [core, capture]) {
  return createGateway({ modules, now: () => now });
}

async function deliver(
  update: Update,
  gateway: ReturnType<typeof gatewayWith> = gatewayWith(),
  testEnv: Env = env,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

interface TextOptions {
  sentAt?: Date;
  updateId?: number;
  messageId?: number;
}

function textUpdate(text: string, options: TextOptions = {}): Update {
  return messageUpdate({
    text,
    updateId: options.updateId ?? UPDATE_ID,
    messageId: options.messageId ?? MESSAGE_ID,
    date: seconds(options.sentAt ?? SENT),
  });
}

/** Ana sends the text, and the bot handles it a few seconds later. */
async function sendText(text: string, options: TextOptions = {}): Promise<Response> {
  now = handledAfter(options.sentAt ?? SENT);
  return deliver(textUpdate(text, options));
}

/** The sendMessage calls that Telegram accepted. */
function sent(): TelegramCall[] {
  return telegram.callsTo("sendMessage").filter((call) => !call.failed);
}

function payloadOf(call: TelegramCall | undefined): SendPayload {
  expect(call).toBeDefined();
  return call?.payload as SendPayload;
}

/** The one accepted reply. It is plain text, sent to the message, with no link preview. */
function onlyReply(messageId = MESSAGE_ID): string {
  const calls = sent();
  expect(calls).toHaveLength(1);
  const payload = payloadOf(calls[0]);
  expect(payload.chat_id).toBe(ALLOWED_CHAT_ID);
  expect(payload.reply_parameters?.message_id).toBe(messageId);
  expect(payload.reply_parameters?.allow_sending_without_reply).toBe(true);
  expect(payload.link_preview_options).toEqual({ is_disabled: true });
  expect(payload).not.toHaveProperty("parse_mode");
  return payload.text;
}

/** The buttons of the one accepted reply. */
function onlyReplyButtons(): unknown {
  const calls = sent();
  expect(calls).toHaveLength(1);
  return payloadOf(calls[0]).reply_markup?.inline_keyboard;
}

function button(text: string, data: string) {
  return { text, callback_data: data };
}

async function rows(): Promise<ExpenseRow[]> {
  const result = await env.DB.prepare("SELECT * FROM expenses ORDER BY source_message_id, item_index").all<ExpenseRow>();
  return result.results;
}

async function teach(keyword: string, categoryId: string, source: "learned" | "llm" = "learned"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO keyword_map (keyword, category_id, source, taught_by, hit_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(keyword, categoryId, source, MEMBER_A.id, SENT.toISOString(), SENT.toISOString())
    .run();
}

async function expectNothingHappened(): Promise<void> {
  expect(telegram.callsTo("sendMessage")).toEqual([]);
  expect(await rows()).toEqual([]);
}

describe("Which messages are captured", () => {
  it("A photo with a caption is ignored", async () => {
    const response = await deliver(
      photoUpdate({ caption: "lunch 250", updateId: UPDATE_ID, messageId: MESSAGE_ID, date: seconds(SENT) }),
    );

    expect(response.status).toBe(200);
    await expectNothingHappened();
  });

  it("A sticker or a voice note is ignored", async () => {
    const sticker = await deliver(stickerUpdate({ updateId: UPDATE_ID, messageId: MESSAGE_ID, date: seconds(SENT) }));
    const voice = await deliver(voiceUpdate({ updateId: UPDATE_ID + 1, messageId: MESSAGE_ID + 1, date: seconds(SENT) }));

    expect(sticker.status).toBe(200);
    expect(voice.status).toBe(200);
    await expectNothingHappened();
  });

  it("An edit is ignored", async () => {
    const first = await sendText("lunch 250");
    const edit = await deliver(
      editedMessageUpdate({
        text: "lunch 300",
        updateId: UPDATE_ID + 1,
        messageId: MESSAGE_ID,
        date: seconds(SENT),
        editDate: seconds(SENT) + 60,
      }),
    );

    expect(first.status).toBe(200);
    expect(edit.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ amount_centavos: 25000, description: "lunch" });
    expect(sent()).toHaveLength(1);
  });

  it("A forwarded message is ignored", async () => {
    const update = textUpdate("lunch 250");
    Object.assign(update.message!, {
      forward_origin: { type: "hidden_user", date: seconds(SENT) - 3600, sender_user_name: "Someone" },
    });

    const response = await deliver(update);

    expect(response.status).toBe(200);
    await expectNothingHappened();
  });

  it("A message sent through another bot is ignored", async () => {
    const update = textUpdate("lunch 250");
    Object.assign(update.message!, { via_bot: { id: 555, is_bot: true, first_name: "Gif", username: "gif" } });

    const response = await deliver(update);

    expect(response.status).toBe(200);
    await expectNothingHappened();
  });

  it("A reply to another message is captured", async () => {
    const update = textUpdate("lunch 250");
    Object.assign(update.message!, {
      reply_to_message: {
        message_id: MESSAGE_ID - 1,
        date: seconds(SENT) - 60,
        chat: update.message!.chat,
        text: "magkano lunch",
      },
    });

    const response = await deliver(update);

    expect(response.status).toBe(200);
    expect(await rows()).toHaveLength(1);
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
  });
});

describe("The message is read at the time it was sent", () => {
  it("Happy path — handled seconds after it was sent", async () => {
    now = new Date("2026-09-29T02:00:03.000Z");

    const response = await deliver(textUpdate("lunch 250", { sentAt: SENT }));

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.spent_on).toBe("2026-09-29");
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
  });

  it("A late attempt keeps the send date", async () => {
    const sentAt = new Date("2026-09-29T15:59:00.000Z");
    now = new Date("2026-09-29T16:00:05.000Z");

    const response = await deliver(textUpdate("lunch 250", { sentAt }));

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.spent_on).toBe("2026-09-29");
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · yesterday");
  });

  it("Failure — a date that was in the future when the message was sent", async () => {
    const sentAt = new Date("2026-09-29T15:59:00.000Z");
    now = new Date("2026-09-29T16:00:05.000Z");

    const response = await deliver(textUpdate("sep 30 lunch 250", { sentAt }));

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(onlyReply()).toBe("❌ Not logged: the date is in the future.");
  });
});

describe("Ordinary chat gets no reply", () => {
  it.each([
    ["thanks", "ok thanks"],
    ["a time of day", "see you at 5pm"],
    ["a time without am or pm", "see you at 7"],
    ["a one-time code", "OTP: 123456"],
    ["a phone number", "call me 0917 123 4567"],
    ["a plus one", "+1"],
    ["a future date and a time", "see you on oct 15 at 7"],
    ["a question in Tagalog", "magkano na gastos natin?"],
    ["an expense with a question mark", "lunch 250?"],
  ])("Casual chat: %s", async (_label, text) => {
    const response = await sendText(text);

    expect(response.status).toBe(200);
    await expectNothingHappened();
  });
});

describe("A rejected message gets one reply with the reason", () => {
  it("A future date", async () => {
    const response = await sendText("oct 15 rent 12000");

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(onlyReply()).toBe("❌ Not logged: the date is in the future.");
  });

  it("An amount out of range", async () => {
    const response = await sendText("condo 25,000,000");

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(onlyReply()).toBe(REJECTED_AMOUNT);
  });

  it("A zero amount", async () => {
    const response = await sendText("lunch 0");

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(onlyReply()).toBe(REJECTED_AMOUNT);
  });

  it("Too many items", async () => {
    const words = ["lunch", "dinner", "coffee", "grab", "toll", "parking", "milk", "bigas", "gulay", "isda", "prutas"];
    const text = words.map((word, i) => `${word} ${(i + 1) * 10}`).join("\n");
    expect(text.split("\n")).toHaveLength(11);

    const response = await sendText(text);

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(onlyReply()).toBe("❌ Not logged: 10 items per message at most. Send the rest in another message.");
  });
});

describe("Each item is stored as an entry", () => {
  it("One expense", async () => {
    const response = await sendText("lunch 250");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      chat_id: ALLOWED_CHAT_ID,
      source_message_id: MESSAGE_ID,
      item_index: 0,
      payer_user_id: MEMBER_A.id,
      created_by: MEMBER_A.id,
      amount_centavos: 25000,
      currency: "PHP",
      description: "lunch",
      category_id: "dining",
      category_source: "keyword",
      spent_on: "2026-09-29",
      raw_text: "lunch 250",
      parser: "rules",
      check_amount: 0,
      deleted_at: null,
    });
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
  });

  it("Two expenses in one message", async () => {
    const response = await sendText("grab 180, groceries 2340 gcash");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      item_index: 0,
      amount_centavos: 18000,
      description: "grab",
      category_id: "transport",
      raw_text: "grab 180, groceries 2340 gcash",
    });
    expect(stored[1]).toMatchObject({
      item_index: 1,
      amount_centavos: 234000,
      description: "groceries gcash",
      category_id: "groceries",
      raw_text: "grab 180, groceries 2340 gcash",
    });
  });

  it("A flagged amount", async () => {
    const response = await sendText("dinner for 2 600");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      amount_centavos: 60000,
      description: "dinner for 2",
      category_id: "dining",
      check_amount: 1,
    });
  });

  it("A backdated expense", async () => {
    const response = await sendText("kahapon lunch 250");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.spent_on).toBe("2026-09-28");
  });

  it("No keyword matches", async () => {
    const response = await sendText("acai 150");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ category_id: "other", category_source: "default" });
  });

  it("A bare number is an expense", async () => {
    const response = await sendText("250");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ amount_centavos: 25000, description: "", category_id: "other" });
    expect(onlyReply()).toBe("✅ ₱250 · ❓ Other · Ana · today");
  });

  it("A learned keyword is used", async () => {
    await teach("acai", "dining");

    const response = await sendText("acai 150");

    expect(response.status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ description: "acai", category_id: "dining", category_source: "learned" });
  });
});

describe("One confirmation per message", () => {
  it("One expense is confirmed on one line", async () => {
    const response = await sendText("lunch 250");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.confirmation_message_id).toBe(CONFIRMATION_ID);
    const id = stored[0]?.id;
    expect(onlyReplyButtons()).toEqual([[button("Category", `c:${id}`), button("Undo", `u:${id}`)]]);
  });

  it("Several expenses are confirmed together", async () => {
    const response = await sendText("grab 180, groceries 2340 gcash");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe(
      [
        "✅ 2 entries · ₱2,520 · Ana · today",
        "1. ₱180 · 🚗 Transport · grab",
        "2. ₱2,340 · 🛒 Groceries · groceries gcash",
      ].join("\n"),
    );
    const stored = await rows();
    expect(stored.map((row) => row.confirmation_message_id)).toEqual([CONFIRMATION_ID, CONFIRMATION_ID]);
    const [first, second] = stored.map((row) => row.id);
    expect(onlyReplyButtons()).toEqual([
      [button("1 · Category", `c:${first}`), button("1 · Undo", `u:${first}`)],
      [button("2 · Category", `c:${second}`), button("2 · Undo", `u:${second}`)],
    ]);
  });

  it("Centavos are shown when they are not zero", async () => {
    const response = await sendText("groceries 1,500.50");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱1,500.50 · 🛒 Groceries · Ana · today");
  });

  it("Yesterday", async () => {
    const response = await sendText("kahapon lunch 250");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · yesterday");
  });

  it("An earlier date this year", async () => {
    const response = await sendText("sep 27 meralco 3200");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱3,200 · 💡 Bills · Ana · Sep 27");
  });

  it("A date in the previous year", async () => {
    const response = await sendText("dec 30 gift 500", { sentAt: new Date("2027-01-02T02:00:00.000Z") });

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱500 · 🎁 Gifts · Ana · Dec 30, 2026");
    const stored = await rows();
    expect(stored[0]?.spent_on).toBe("2026-12-30");
  });

  it("A flagged amount is marked", async () => {
    const response = await sendText("dinner for 2 600");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱600 · 🍽 Dining · Ana · today · ⚠️ check amount");
  });

  it("Text is shown as typed", async () => {
    const response = await sendText("a<b 100, c&d 200");

    expect(response.status).toBe(200);
    // onlyReply also asserts there is no parse_mode and that link previews are off.
    expect(onlyReply()).toBe(
      ["✅ 2 entries · ₱300 · Ana · today", "1. ₱100 · ❓ Other · a<b", "2. ₱200 · ❓ Other · c&d"].join("\n"),
    );
  });

  it("A long description is shortened", async () => {
    const description = "x".repeat(70);

    const response = await sendText(`${description} 100, coffee 80`);

    expect(response.status).toBe(200);
    expect(onlyReply().split("\n")[1]).toBe(`1. ₱100 · ❓ Other · ${"x".repeat(59)}…`);
    const stored = await rows();
    expect(stored[0]?.description).toBe(description);
  });

  it("The member's message was deleted", async () => {
    // The stub cannot delete a message, so the test checks the request that Telegram
    // accepts when the message is gone: a reply that may be sent without its target.
    const response = await sendText("lunch 250");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
    const payload = payloadOf(sent()[0]);
    expect(payload.reply_parameters).toEqual({ message_id: MESSAGE_ID, allow_sending_without_reply: true });
  });

  it("An empty description", async () => {
    const response = await sendText("250, coffee 80");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe(
      ["✅ 2 entries · ₱330 · Ana · today", "1. ₱250 · ❓ Other", "2. ₱80 · 🍽 Dining · coffee"].join("\n"),
    );
  });

  it("A rejection carries no buttons", async () => {
    const response = await sendText("oct 15 rent 12000");

    expect(response.status).toBe(200);
    expect(onlyReply()).toBe("❌ Not logged: the date is in the future.");
    expect(payloadOf(sent()[0])).not.toHaveProperty("reply_markup");
  });
});

describe("Repeating an update is safe", () => {
  it("The confirmation fails to send", async () => {
    const gateway = gatewayWith();
    const update = textUpdate("lunch 250");
    now = handledAfter(SENT);
    const firstCreated = now.toISOString();
    telegram.failNext("sendMessage");

    const first = await deliver(update, gateway);

    expect(first.status).toBe(500);
    expect(sent()).toEqual([]);
    const afterFirst = await rows();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.confirmation_message_id).toBeNull();

    now = new Date(now.getTime() + RETRY_AFTER_MS);
    const second = await deliver(update, gateway);

    expect(second.status).toBe(200);
    expect(onlyReply()).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
    const afterSecond = await rows();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.created_at).toBe(firstCreated);
    expect(afterSecond[0]?.confirmation_message_id).toBe(CONFIRMATION_ID);
  });

  it("The handler runs again after the confirmation was sent", async () => {
    const probe = probeModule({ messages: ["after"] });
    const gateway = gatewayWith([core, capture, probe.module]);
    const update = textUpdate("lunch 250");
    probe.failWith(new Error("a later handler failed"));
    now = handledAfter(SENT);

    const first = await deliver(update, gateway);

    expect(first.status).toBe(500);
    expect(sent()).toHaveLength(1);
    expect(await rows()).toHaveLength(1);

    probe.clearFailure();
    now = new Date(now.getTime() + RETRY_AFTER_MS);
    const second = await deliver(update, gateway);

    expect(second.status).toBe(200);
    expect(probe.callsTo("message:after")).toHaveLength(2);
    expect(sent()).toHaveLength(1);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.confirmation_message_id).toBe(CONFIRMATION_ID);
  });

  it("The reply's message id cannot be saved", async () => {
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => /^UPDATE expenses\b/i.test(sql) && sql.includes("confirmation_message_id"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    now = handledAfter(SENT);

    const response = await deliver(textUpdate("lunch 250"), gatewayWith(), { ...env, DB: failing.db });
    failing.heal();

    expect(response.status).toBe(200);
    expect(sent()).toHaveLength(1);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.confirmation_message_id).toBeNull();

    const lines = log.mock.calls
      .map((args) => args[0])
      .filter((line): line is string => typeof line === "string" && line.includes("capture_confirmation_unsaved"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      event: "capture_confirmation_unsaved",
      update_id: UPDATE_ID,
      message_id: MESSAGE_ID,
      confirmation_message_id: CONFIRMATION_ID,
    });
    expect(lines[0]).not.toContain("lunch");
    expect(lines[0]).not.toContain("Ana");
  });

  it("A rejection is not stored", async () => {
    const gateway = gatewayWith();
    const update = textUpdate("oct 15 rent 12000");
    now = handledAfter(SENT);
    telegram.failNext("sendMessage");

    const first = await deliver(update, gateway);

    expect(first.status).toBe(500);
    expect(sent()).toEqual([]);
    expect(await rows()).toEqual([]);

    now = new Date(now.getTime() + RETRY_AFTER_MS);
    const second = await deliver(update, gateway);

    expect(second.status).toBe(200);
    expect(onlyReply()).toBe("❌ Not logged: the date is in the future.");
    expect(await rows()).toEqual([]);
  });
});
