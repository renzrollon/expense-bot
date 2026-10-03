import { env } from "cloudflare:workers";
import { BotError } from "grammy";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBot } from "../src/gateway/bot";
import type { Config } from "../src/gateway/config";
import type { FeatureModule } from "../src/gateway/registry";
import { BOT_INFO, BOT_TOKEN, BOT_USERNAME, HOUSEHOLD_TZ, MEMBER_A, MEMBER_B } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { gatewayState } from "./helpers/gateway-state";
import { probeModule } from "./helpers/probe";
import { logEntries } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate, editedMessageUpdate, messageUpdate, photoUpdate } from "./helpers/updates";

const config: Config = {
  botToken: BOT_TOKEN,
  botInfo: BOT_INFO,
  memberIds: [MEMBER_A.id, MEMBER_B.id],
  timezone: HOUSEHOLD_TZ,
};

const STALE_BUTTON = "This button no longer works.";

useCleanTables(env.DB);

let telegram: TelegramStub;
beforeEach(() => {
  telegram = installTelegramStub();
});
afterEach(() => {
  telegram.restore();
});

/** Builds the bot synchronously, so a failure to build it throws before any promise exists. */
function handle(modules: FeatureModule[], ...updates: Update[]): Promise<void> {
  const bot = buildBot(config, gatewayState(modules));
  return (async () => {
    for (const update of updates) {
      await bot.handleUpdate(update);
    }
  })();
}

function argsOf(probe: ReturnType<typeof probeModule>, handler: string): unknown[] {
  return probe.callsTo(handler).map((call) => call.args[1]);
}

describe("Command routing", () => {
  it("Registered command", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"] });

    await handle([probe.module], messageUpdate({ text: "/ping" }));

    expect(probe.callsTo("command:ping")).toHaveLength(1);
    expect(probe.callsTo("message:any")).toHaveLength(0);
  });

  it("Command with arguments", async () => {
    const probe = probeModule({ commands: ["ping"] });

    await handle([probe.module], messageUpdate({ text: "/ping   120 coffee  \n" }));

    expect(argsOf(probe, "command:ping")).toEqual(["120 coffee"]);
  });

  it("Command followed only by white space", async () => {
    const probe = probeModule({ commands: ["ping"] });

    await handle(
      [probe.module],
      messageUpdate({ text: "/ping   ", updateId: 1 }),
      messageUpdate({ text: "/ping\n", updateId: 2 }),
    );

    expect(argsOf(probe, "command:ping")).toEqual(["", ""]);
  });

  it("Command addressed to this bot", async () => {
    const probe = probeModule({ commands: ["ping"] });
    const mixedCase = BOT_USERNAME.split("")
      .map((char, i) => (i % 2 === 0 ? char.toUpperCase() : char))
      .join("");

    await handle(
      [probe.module],
      messageUpdate({ text: `/ping@${BOT_USERNAME}`, updateId: 1 }),
      messageUpdate({ text: `/ping@${BOT_USERNAME.toUpperCase()}`, updateId: 2 }),
      messageUpdate({ text: `/ping@${mixedCase} now`, updateId: 3 }),
    );

    expect(argsOf(probe, "command:ping")).toEqual(["", "", "now"]);
  });

  it("Command addressed to another bot", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"] });

    await expect(handle([probe.module], messageUpdate({ text: "/ping@other_bot" }))).resolves.toBeUndefined();

    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
  });

  it("Command in another letter case", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"] });

    await expect(handle([probe.module], messageUpdate({ text: "/PING" }))).resolves.toBeUndefined();

    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
  });

  it("Unknown command", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"] });

    await expect(handle([probe.module], messageUpdate({ text: "/unknown 5" }))).resolves.toBeUndefined();

    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
  });

  it("Command in a photo caption", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"] });

    await handle([probe.module], photoUpdate({ caption: "/ping look" }));

    expect(probe.callsTo("command:ping")).toHaveLength(0);
    expect(probe.callsTo("message:any")).toHaveLength(1);
  });
});

describe("Button routing", () => {
  it("Registered prefix", async () => {
    const probe = probeModule({ callbacks: ["x"] });

    await handle([probe.module], callbackUpdate({ data: "x:42:food" }));

    expect(argsOf(probe, "callback:x")).toEqual(["42:food"]);
  });

  it("Empty payload", async () => {
    const probe = probeModule({ callbacks: ["x"] });

    await handle([probe.module], callbackUpdate({ data: "x:" }));

    expect(argsOf(probe, "callback:x")).toEqual([""]);
  });

  it("Unknown prefix", async () => {
    const probe = probeModule({ callbacks: ["x"], messages: ["any"] });

    await handle([probe.module], callbackUpdate({ data: "gone:42", updateId: 7 }));

    expect(probe.calls).toEqual([]);
    expect(telegram.calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(telegram.calls[0]?.payload).toMatchObject({ callback_query_id: "cb-7", text: STALE_BUTTON });
  });

  it("Unknown prefix, pressed too late to answer", async () => {
    const probe = probeModule({ callbacks: ["x"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    telegram.failNext("answerCallbackQuery", {
      error_code: 400,
      description: "Bad Request: query is too old and response timeout expired or query ID is invalid",
    });

    try {
      await expect(handle([probe.module], callbackUpdate({ data: "gone:42", updateId: 8 }))).resolves.toBeUndefined();
      expect(telegram.callsTo("answerCallbackQuery")[0]?.failed).toBe(true);
      expect(logEntries(logSpy)).toEqual([{ event: "callback_answer_failed", update_id: 8 }]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("Unknown prefix, answered after a short rate limit", async () => {
    const probe = probeModule({ callbacks: ["x"] });
    telegram.failNext("answerCallbackQuery", {
      error_code: 429,
      description: "Too Many Requests: retry after 0",
      parameters: { retry_after: 0 },
    });

    await handle([probe.module], callbackUpdate({ data: "gone:42", updateId: 9 }));

    expect(telegram.callsTo("answerCallbackQuery").map((call) => call.failed ?? false)).toEqual([true, false]);
  });

  it("Data without a usable prefix", async () => {
    const probe = probeModule({ callbacks: ["x"], messages: ["any"] });
    const presses = [
      callbackUpdate({ updateId: 11 }),
      callbackUpdate({ data: "", updateId: 12 }),
      callbackUpdate({ data: "x42", updateId: 13 }),
      callbackUpdate({ data: ":x:42", updateId: 14 }),
    ];

    await handle([probe.module], ...presses);

    expect(probe.calls).toEqual([]);
    expect(telegram.calls.map((call) => call.method)).toEqual([
      "answerCallbackQuery",
      "answerCallbackQuery",
      "answerCallbackQuery",
      "answerCallbackQuery",
    ]);
    expect(telegram.calls.map((call) => call.payload)).toEqual(
      [11, 12, 13, 14].map((id) => expect.objectContaining({ callback_query_id: `cb-${id}`, text: STALE_BUTTON })),
    );
  });
});

describe("Message routing", () => {
  it("Message without a command", async () => {
    const probe = probeModule({ messages: ["first", "second"] });

    await handle([probe.module], messageUpdate({ text: "coffee 120" }));

    expect(probe.calls.map((call) => call.handler)).toEqual(["message:first", "message:second"]);
  });

  it("Edited message", async () => {
    const probe = probeModule({ commands: ["ping"], messages: ["any"], editedMessages: ["fix"] });

    await handle(
      [probe.module],
      editedMessageUpdate({ text: "coffee 150", updateId: 1 }),
      editedMessageUpdate({ text: "/ping now", updateId: 2 }),
    );

    expect(probe.calls.map((call) => call.handler)).toEqual(["edited:fix", "edited:fix"]);
  });

  it("No handler is registered", async () => {
    const probe = probeModule({ commands: ["ping"] });

    await expect(handle([probe.module], messageUpdate({ text: "coffee 120" }))).resolves.toBeUndefined();

    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
  });

  it("Handler failure stops later handlers", async () => {
    const probe = probeModule({ messages: ["first", "second"] });
    const failure = new Error("first failed");
    probe.failWith(failure, "message:first");

    const bot = buildBot(config, gatewayState([probe.module]));

    const outcome = await bot.handleUpdate(messageUpdate({ text: "coffee 120" })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).not.toBeNull();
    const passedOn = outcome instanceof BotError ? outcome.error : outcome;
    expect(passedOn).toBe(failure);
    expect(probe.calls.map((call) => call.handler)).toEqual(["message:first"]);
  });
});

describe("Job registration", () => {
  it("Job is not run", async () => {
    const probe = probeModule({ messages: ["any"], jobs: [{ name: "daily" }] });

    await handle([probe.module], messageUpdate({ text: "coffee 120" }));

    expect(probe.callsTo("message:any")).toHaveLength(1);
    expect(probe.callsTo("job:daily")).toHaveLength(0);
  });
});
