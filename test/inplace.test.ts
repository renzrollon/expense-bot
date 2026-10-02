import type { InlineKeyboardButton } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { buildBot } from "../src/gateway/bot";
import type { Config } from "../src/gateway/config";
import type { FeatureModule } from "../src/gateway/registry";
import { answerPress, editInPlace, showButtons } from "../src/telegram/inplace";
import { ALLOWED_CHAT_ID, BOT_INFO, BOT_TOKEN, HOUSEHOLD_TZ, MEMBER_A, MEMBER_B } from "./helpers/constants";
import { gatewayState } from "./helpers/gateway-state";
import { logEntries } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate } from "./helpers/updates";

const config: Config = {
  botToken: BOT_TOKEN,
  botInfo: BOT_INFO,
  memberIds: [MEMBER_A.id, MEMBER_B.id],
  timezone: HOUSEHOLD_TZ,
};

const TARGET = { chatId: ALLOWED_CHAT_ID, messageId: 55 };
const KEYBOARD: InlineKeyboardButton[][] = [[{ text: "Undo", callback_data: "u:7" }]];
const VIEW = { text: "✅ ₱250 · 🍽 Dining · lunch", keyboard: KEYBOARD };
const UPDATE_ID = 9001;

const NOT_MODIFIED = {
  error_code: 400,
  description:
    "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
};
const NOT_FOUND = { error_code: 400, description: "Bad Request: message to edit not found" };
const SERVER_ERROR = { error_code: 500, description: "Internal Server Error: injected" };
const TOO_MANY = { error_code: 429, description: "Too Many Requests: retry after 5" };

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  telegram = installTelegramStub();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  telegram.restore();
  logSpy.mockRestore();
});

function api() {
  return buildBot(config, gatewayState([])).api;
}

describe("editInPlace", () => {
  it("edits the text and keyboard with link previews off and no parse_mode", async () => {
    await editInPlace(api(), TARGET, VIEW, UPDATE_ID);

    const calls = telegram.callsTo("editMessageText");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      chat_id: ALLOWED_CHAT_ID,
      message_id: 55,
      text: VIEW.text,
      reply_markup: { inline_keyboard: KEYBOARD },
      link_preview_options: { is_disabled: true },
    });
    expect(calls[0]?.payload).not.toHaveProperty("parse_mode");
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("an empty keyboard removes the buttons", async () => {
    await editInPlace(api(), TARGET, { text: "✅ No spending on 2026-09-30.", keyboard: [] }, UPDATE_ID);

    expect(telegram.callsTo("editMessageText")[0]?.payload).toMatchObject({
      reply_markup: { inline_keyboard: [] },
      link_preview_options: { is_disabled: true },
    });
  });

  it("a 400 'message is not modified' resolves and logs nothing", async () => {
    telegram.failNext("editMessageText", NOT_MODIFIED);

    await expect(editInPlace(api(), TARGET, VIEW, UPDATE_ID)).resolves.toBeUndefined();

    expect(telegram.callsTo("editMessageText")[0]?.failed).toBe(true);
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("a 400 with another description resolves and logs edit_skipped with the update id only", async () => {
    telegram.failNext("editMessageText", NOT_FOUND);

    await expect(editInPlace(api(), TARGET, VIEW, UPDATE_ID)).resolves.toBeUndefined();

    expect(logEntries(logSpy)).toEqual([{ event: "edit_skipped", update_id: UPDATE_ID }]);
  });

  it("a 500 rejects", async () => {
    telegram.failNext("editMessageText", SERVER_ERROR);

    await expect(editInPlace(api(), TARGET, VIEW, UPDATE_ID)).rejects.toThrow();
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("a 429 rejects", async () => {
    telegram.failNext("editMessageText", TOO_MANY);

    await expect(editInPlace(api(), TARGET, VIEW, UPDATE_ID)).rejects.toThrow();
    expect(logEntries(logSpy)).toEqual([]);
  });
});

describe("showButtons", () => {
  it("edits only the keyboard, with no parse_mode", async () => {
    await showButtons(api(), TARGET, KEYBOARD, UPDATE_ID);

    const calls = telegram.callsTo("editMessageReplyMarkup");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      chat_id: ALLOWED_CHAT_ID,
      message_id: 55,
      reply_markup: { inline_keyboard: KEYBOARD },
    });
    expect(telegram.callsTo("editMessageText")).toEqual([]);
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("a 400 'message is not modified' resolves and logs nothing", async () => {
    telegram.failNext("editMessageReplyMarkup", NOT_MODIFIED);

    await expect(showButtons(api(), TARGET, KEYBOARD, UPDATE_ID)).resolves.toBeUndefined();
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("a 400 with another description resolves and logs edit_skipped with the update id only", async () => {
    telegram.failNext("editMessageReplyMarkup", NOT_FOUND);

    await expect(showButtons(api(), TARGET, KEYBOARD, UPDATE_ID)).resolves.toBeUndefined();
    expect(logEntries(logSpy)).toEqual([{ event: "edit_skipped", update_id: UPDATE_ID }]);
  });

  it("a 500 rejects", async () => {
    telegram.failNext("editMessageReplyMarkup", SERVER_ERROR);

    await expect(showButtons(api(), TARGET, KEYBOARD, UPDATE_ID)).rejects.toThrow();
  });

  it("a 429 rejects", async () => {
    telegram.failNext("editMessageReplyMarkup", TOO_MANY);

    await expect(showButtons(api(), TARGET, KEYBOARD, UPDATE_ID)).rejects.toThrow();
  });
});

describe("answerPress", () => {
  /** A module whose `t` press answers with `text`, and records whether the answer resolved. */
  function presser(text?: string): { module: FeatureModule; outcomes: string[] } {
    const outcomes: string[] = [];
    const module: FeatureModule = {
      name: "presser",
      commands: [],
      callbacks: [
        {
          prefix: "t",
          handle: async (ctx) => {
            await answerPress(ctx, text);
            outcomes.push("resolved");
          },
        },
      ],
      messages: [],
      editedMessages: [],
      jobs: [],
    };
    return { module, outcomes };
  }

  async function press(module: FeatureModule, updateId: number): Promise<void> {
    await buildBot(config, gatewayState([module])).handleUpdate(callbackUpdate({ data: "t:1", updateId }));
  }

  it("answers the press with the text", async () => {
    const { module, outcomes } = presser("Removed.");

    await press(module, 31);

    expect(outcomes).toEqual(["resolved"]);
    expect(telegram.callsTo("answerCallbackQuery").map((call) => call.payload)).toEqual([
      { callback_query_id: "cb-31", text: "Removed." },
    ]);
    expect(logEntries(logSpy)).toEqual([]);
  });

  it("answers the press with no text", async () => {
    const { module } = presser();

    await press(module, 32);

    expect(telegram.callsTo("answerCallbackQuery").map((call) => call.payload)).toEqual([
      { callback_query_id: "cb-32" },
    ]);
  });

  it("resolves and logs callback_answer_failed when answerCallbackQuery fails", async () => {
    const { module, outcomes } = presser("Removed.");
    telegram.failNext("answerCallbackQuery", {
      error_code: 400,
      description: "Bad Request: query is too old and response timeout expired or query ID is invalid",
    });

    await press(module, 33);

    expect(outcomes).toEqual(["resolved"]);
    expect(telegram.callsTo("answerCallbackQuery")[0]?.failed).toBe(true);
    expect(logEntries(logSpy)).toEqual([{ event: "callback_answer_failed", update_id: 33 }]);
  });

  it("resolves and logs callback_answer_failed on a 500 too", async () => {
    const { module, outcomes } = presser();
    telegram.failNext("answerCallbackQuery", SERVER_ERROR);

    await press(module, 34);

    expect(outcomes).toEqual(["resolved"]);
    expect(logEntries(logSpy)).toEqual([{ event: "callback_answer_failed", update_id: 34 }]);
  });
});
