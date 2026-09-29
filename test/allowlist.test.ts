import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createGateway } from "../src/gateway";
import { ALLOWED_CHAT_ID, MEMBER_A, MEMBER_B } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { probeModule, type Probe } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate, messageUpdate } from "./helpers/updates";

useCleanTables(env.DB);

const NOW = new Date("2026-09-29T10:05:30.123Z");
const OTHER_CHAT_ID = -1009999999999;
const NON_MEMBER = { id: 2001, firstName: "Stranger", username: "stranger" };
/** Telegram's sender for anonymous administrators. */
const GROUP_ANONYMOUS_BOT = { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" };
/** Telegram's sender for a message posted on behalf of a channel. */
const CHANNEL_BOT = { id: 136817688, is_bot: true, first_name: "Channel", username: "Channel_Bot" };

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let probe: Probe;

beforeEach(() => {
  telegram = installTelegramStub();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  probe = probeModule({ commands: ["tally"], callbacks: ["x"], messages: ["first"], editedMessages: ["first"] });
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

async function storeAllowedChat(value: string = String(ALLOWED_CHAT_ID)): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(value, NOW.toISOString())
    .run();
}

/** A changed copy of the test environment. */
function envWith(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

async function send(update: unknown, testEnv: Env = env): Promise<Response> {
  const gateway = createGateway({ modules: [probe.module], now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

async function count(table: "updates" | "members"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function expectIgnored(response: Response): Promise<void> {
  await expectEmpty(response, 200);
  expect(probe.calls).toEqual([]);
  expect(telegram.calls).toEqual([]);
  expect(await count("updates")).toBe(0);
  expect(await count("members")).toBe(0);
}

function logLines(): Record<string, unknown>[] {
  return logSpy.mock.calls.map((args) => {
    try {
      return JSON.parse(String(args[0])) as Record<string, unknown>;
    } catch {
      return { unparsed: String(args[0]) };
    }
  });
}

/** A message update from a member in the allowed chat, with fields replaced or added. */
function messageWith(fields: Record<string, unknown>, updateId = 60): unknown {
  const update = messageUpdate({ text: "coffee 120", updateId });
  return { update_id: updateId, message: { ...update.message, ...fields } };
}

describe("Chat and member allowlist", () => {
  beforeEach(async () => {
    await storeAllowedChat();
  });

  it("Member in the allowed chat", async () => {
    const update = messageUpdate({ text: "coffee 120", updateId: 61 });
    await expectEmpty(await send(update), 200);
    const row = await env.DB.prepare("SELECT update_id, chat_id, user_id FROM updates").first();
    expect(row).toEqual({ update_id: 61, chat_id: ALLOWED_CHAT_ID, user_id: MEMBER_A.id });
    expect(probe.callsTo("message:first")).toHaveLength(1);
  });

  it("Update from another chat", async () => {
    await expectIgnored(await send(messageUpdate({ text: "coffee 120", chatId: OTHER_CHAT_ID })));
  });

  it("Member writes to the bot in a private chat", async () => {
    const update = messageWith({ chat: { id: MEMBER_A.id, type: "private", first_name: MEMBER_A.firstName } });
    await expectIgnored(await send(update));
  });

  it("Non-member in the allowed chat", async () => {
    const update = messageUpdate({
      text: "coffee 120",
      userId: NON_MEMBER.id,
      firstName: NON_MEMBER.firstName,
      username: NON_MEMBER.username,
    });
    await expectIgnored(await send(update));
  });

  it("Button press by a non-member", async () => {
    const update = callbackUpdate({ data: "x:1", userId: NON_MEMBER.id, firstName: NON_MEMBER.firstName });
    await expectIgnored(await send(update));
    expect(telegram.callsTo("answerCallbackQuery")).toEqual([]);
  });

  it("Sender identity is hidden", async () => {
    const anonymousAdmin = messageWith(
      { from: GROUP_ANONYMOUS_BOT, sender_chat: { id: ALLOWED_CHAT_ID, type: "supergroup", title: "Household" } },
      62,
    );
    await expectIgnored(await send(anonymousAdmin));
    const onBehalfOfChannel = messageWith(
      { from: CHANNEL_BOT, sender_chat: { id: -1005550001, type: "channel", title: "News" } },
      63,
    );
    await expectIgnored(await send(onBehalfOfChannel));
  });

  it("Message without a sender", async () => {
    await expectIgnored(await send(messageWith({ from: undefined })));
  });

  it("Guest or business message", async () => {
    await expectIgnored(await send(messageWith({ guest_query_id: "guest-1" }, 64)));
    await expectIgnored(await send(messageWith({ business_connection_id: "business-1" }, 65)));
  });

  it("Button press without a chat", async () => {
    const press = callbackUpdate({ data: "x:1", updateId: 66 }).callback_query;
    const update = { update_id: 66, callback_query: { ...press, message: undefined, inline_message_id: "inline-1" } };
    await expectIgnored(await send(update));
    expect(telegram.callsTo("answerCallbackQuery")).toEqual([]);
  });

  it("Redelivery after the sender left the member list", async () => {
    const update = messageUpdate({ text: "coffee 120", updateId: 67 });
    await env.DB.prepare(
      `INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, last_error, received_at, claimed_at)
       VALUES (67, 'message', ?, ?, ?, 'failed', 1, 'boom', ?, ?)`,
    )
      .bind(ALLOWED_CHAT_ID, MEMBER_A.id, JSON.stringify(update), NOW.toISOString(), NOW.toISOString())
      .run();
    const before = await env.DB.prepare("SELECT * FROM updates").all();
    const response = await send(update, envWith({ ALLOWED_USER_IDS: JSON.stringify([MEMBER_B.id]) }));
    await expectEmpty(response, 200);
    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
    expect((await env.DB.prepare("SELECT * FROM updates").all()).results).toEqual(before.results);
    expect(await count("members")).toBe(0);
  });
});

describe("Chat and member allowlist without a usable allowed chat", () => {
  it("No allowed chat is set", async () => {
    await expectIgnored(await send(messageUpdate({ text: "coffee 120" })));
    await expectIgnored(await send(messageUpdate({ text: "coffee 120", chatId: OTHER_CHAT_ID, updateId: 2 })));
  });

  it("Stored chat id is not a number", async () => {
    await storeAllowedChat("household");
    await expectIgnored(await send(messageUpdate({ text: "coffee 120" })));
    await expectIgnored(await send(messageUpdate({ text: "coffee 120", chatId: OTHER_CHAT_ID, updateId: 2 })));
  });
});

describe("Ignored updates are logged without content", () => {
  it("Ignored update is logged", async () => {
    await storeAllowedChat();
    const update = messageUpdate({
      text: "secret lunch 450",
      updateId: 68,
      chatId: OTHER_CHAT_ID,
      firstName: "Zelda",
      username: "zelda_q",
    });
    await expectIgnored(await send(update));
    const entries = logLines().filter((line) => line.event === "update_ignored");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ update_id: 68, reason: "chat_not_allowed" });
    for (const [line] of logSpy.mock.calls) {
      const text = String(line);
      expect(text).not.toContain("secret lunch");
      expect(text).not.toContain("Zelda");
      expect(text).not.toContain("zelda_q");
    }
  });
});
