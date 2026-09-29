import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createGateway } from "../src/gateway";
import { RegistrationError, type FeatureModule } from "../src/gateway/registry";
import { ALLOWED_CHAT_ID, BOT_INFO, MEMBER_A, WEBHOOK_SECRET } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { probeModule, type Probe } from "./helpers/probe";
import { signedRequest, type SignedRequestOptions } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate, messageUpdate } from "./helpers/updates";

useCleanTables(env.DB);

const NOW = new Date("2026-09-29T10:05:30.123Z");

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let probe: Probe;

beforeEach(async () => {
  telegram = installTelegramStub();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  probe = probeModule({ commands: ["tally"], callbacks: ["x"], messages: ["first"], editedMessages: ["first"] });
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), NOW.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

/** A changed copy of the test environment. `undefined` removes a setting. */
function envWith(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

async function send(request: Request, testEnv: Env = env, modules: FeatureModule[] = [probe.module]) {
  const gateway = createGateway({ modules, now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
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

async function count(table: "updates" | "members"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function storedChatId(): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'allowed_chat_id'").first<{ value: string }>();
  return row?.value;
}

async function expectNothingStored(): Promise<void> {
  expect(await count("updates")).toBe(0);
  expect(await count("members")).toBe(0);
  expect(await storedChatId()).toBe(String(ALLOWED_CHAT_ID));
}

function expectNothingRun(): void {
  expect(probe.calls).toEqual([]);
  expect(telegram.calls).toEqual([]);
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

const memberMessage = () => messageUpdate({ text: "coffee 120", updateId: 41 });

function wrongContent(secret: string): string {
  return `${secret.slice(0, -1)}${secret.at(-1) === "x" ? "y" : "x"}`;
}

describe("Webhook request verification", () => {
  it("Missing secret header", async () => {
    const request = signedRequest(memberMessage(), { secret: null });
    await expectEmpty(await send(request), 401);
    expect(request.bodyUsed).toBe(false);
    await expectNothingStored();
    expectNothingRun();
  });

  it("Wrong secret", async () => {
    const secret = wrongContent(WEBHOOK_SECRET);
    expect(secret).toHaveLength(WEBHOOK_SECRET.length);
    const request = signedRequest(memberMessage(), { secret });
    await expectEmpty(await send(request), 401);
    expect(request.bodyUsed).toBe(false);
    await expectNothingStored();
    expectNothingRun();
  });

  it("Secret of a different length", async () => {
    for (const secret of [WEBHOOK_SECRET.slice(0, -1), `${WEBHOOK_SECRET}x`, ""]) {
      await expectEmpty(await send(signedRequest(memberMessage(), { secret })), 401);
    }
    await expectNothingStored();
    expectNothingRun();
  });

  it("No secret configured", async () => {
    const cases: [unknown, SignedRequestOptions][] = [
      [undefined, {}],
      [undefined, { secret: null }],
      [undefined, { secret: "" }],
      ["", {}],
      ["", { secret: null }],
      ["", { secret: "" }],
    ];
    for (const [configured, options] of cases) {
      const response = await send(signedRequest(memberMessage(), options), envWith({ WEBHOOK_SECRET: configured }));
      await expectEmpty(response, 401);
    }
    await expectNothingStored();
    expectNothingRun();
  });

  it("Unknown path or method", async () => {
    const cases: SignedRequestOptions[] = [
      { method: "GET" },
      { method: "PUT" },
      { method: "DELETE" },
      { path: "/" },
      { path: "/other" },
      { path: "/webhook/extra" },
      { path: "/other", method: "GET" },
    ];
    for (const options of cases) {
      const response = await send(signedRequest(memberMessage(), options));
      expect(response.status, JSON.stringify(options)).toBe(404);
    }
    await expectNothingStored();
    expectNothingRun();
  });
});

describe("Configuration validation", () => {
  async function expectConfigRejected(setting: string, overrides: Record<string, unknown>): Promise<void> {
    logSpy.mockClear();
    const response = await send(signedRequest(memberMessage()), envWith(overrides));
    expect(response.status, JSON.stringify(overrides)).toBe(500);
    expect(response.headers.has("Retry-After")).toBe(false);
    const entries = logLines().filter((line) => line.event === "config_invalid");
    expect(entries).toEqual([{ event: "config_invalid", setting }]);
    await expectNothingStored();
    expectNothingRun();
  }

  it("Member list is invalid", async () => {
    for (const value of [undefined, "", "[]", JSON.stringify([MEMBER_A.id, -5]), "[10.5]", '["ben"]']) {
      await expectConfigRejected("ALLOWED_USER_IDS", { ALLOWED_USER_IDS: value });
    }
  });

  it("Member list holds ids as strings of digits", async () => {
    const testEnv = envWith({ ALLOWED_USER_IDS: JSON.stringify([`${MEMBER_A.id}`, "1002"]) });
    await expectEmpty(await send(signedRequest(memberMessage()), testEnv), 200);
    expect(await count("updates")).toBe(1);
    expect(probe.callsTo("message:first")).toHaveLength(1);
  });

  it("Member list holds a duplicate id", async () => {
    const testEnv = envWith({ ALLOWED_USER_IDS: JSON.stringify([MEMBER_A.id, MEMBER_A.id]) });
    await expectEmpty(await send(signedRequest(memberMessage()), testEnv), 200);
    expect(await count("updates")).toBe(1);
    expect(probe.callsTo("message:first")).toHaveLength(1);
  });

  it("Bot identity is invalid", async () => {
    for (const value of [
      undefined,
      "{not json",
      JSON.stringify({ ...BOT_INFO, id: undefined }),
      JSON.stringify({ ...BOT_INFO, id: "424242" }),
      JSON.stringify({ ...BOT_INFO, username: undefined }),
    ]) {
      await expectConfigRejected("BOT_INFO", { BOT_INFO: value });
    }
  });

  it("Timezone is invalid", async () => {
    for (const value of [undefined, "", "Mars/Olympus"]) {
      await expectConfigRejected("HOUSEHOLD_TZ", { HOUSEHOLD_TZ: value });
    }
  });

  it("Bot token is missing", async () => {
    for (const value of [undefined, ""]) {
      await expectConfigRejected("BOT_TOKEN", { BOT_TOKEN: value });
    }
  });
});

describe("Acknowledgement of updates that cannot be processed", () => {
  async function expectAcknowledged(body: string): Promise<void> {
    const response = await send(signedRequest(null, { body }));
    expect(response.status, body).toBe(200);
    expect(await response.text()).toBe("");
  }

  it("Body is not valid JSON", async () => {
    await expectAcknowledged("{not json");
    await expectAcknowledged("");
    expect(logLines().filter((line) => line.event === "body_rejected")).toHaveLength(2);
    await expectNothingStored();
    expectNothingRun();
  });

  it("Body is JSON but not an update", async () => {
    const message = memberMessage().message;
    const bodies = [
      "null",
      "[]",
      JSON.stringify([memberMessage()]),
      "5",
      '"text"',
      "{}",
      JSON.stringify({ message }),
      JSON.stringify({ update_id: "41", message }),
      JSON.stringify({ update_id: null, message }),
    ];
    for (const body of bodies) await expectAcknowledged(body);
    expect(logLines().filter((line) => line.event === "body_rejected")).toHaveLength(bodies.length);
    await expectNothingStored();
    expectNothingRun();
  });

  it("Unsupported update type", async () => {
    const chat = { id: ALLOWED_CHAT_ID, type: "supergroup", title: "Household" };
    const bodies = [
      { update_id: 42 },
      { update_id: 43, channel_post: { message_id: 1, date: 1_780_000_000, chat, text: "hi" } },
      {
        update_id: 44,
        my_chat_member: {
          chat,
          from: { id: MEMBER_A.id, is_bot: false, first_name: MEMBER_A.firstName },
          date: 1_780_000_000,
          old_chat_member: { status: "left", user: BOT_INFO },
          new_chat_member: { status: "member", user: BOT_INFO },
        },
      },
      { update_id: 45, message_reaction: { chat, message_id: 1, date: 1_780_000_000, old_reaction: [], new_reaction: [] } },
    ];
    for (const body of bodies) await expectAcknowledged(JSON.stringify(body));
    await expectNothingStored();
    expectNothingRun();
  });

  it("Update with malformed fields", async () => {
    const message = memberMessage().message as unknown as Record<string, unknown>;
    const callback = callbackUpdate({ data: "x:1" }).callback_query;
    const bodies = [
      { update_id: 46, message: "coffee 120" },
      { update_id: 47, edited_message: 5 },
      { update_id: 48, callback_query: "x:1" },
      { update_id: 49, message: { ...message, chat: undefined } },
      { update_id: 50, message: { ...message, chat: { id: String(ALLOWED_CHAT_ID), type: "supergroup" } } },
      { update_id: 51, message: { ...message, from: { id: MEMBER_A.id, is_bot: false } } },
      { update_id: 52, message: { ...message, migrate_to_chat_id: "-1009876543210" } },
      { update_id: 53, message, callback_query: callback },
      { update_id: 54, message, edited_message: message },
    ];
    for (const body of bodies) await expectAcknowledged(JSON.stringify(body));
    await expectNothingStored();
    expectNothingRun();
  });
});

describe("createGateway", () => {
  it("refuses to start when two modules register the same command", () => {
    const ledger = probeModule({ name: "ledger", commands: ["tally"] }).module;
    const budget = probeModule({ name: "budget", commands: ["tally"] }).module;
    let caught: unknown;
    try {
      createGateway({ modules: [ledger, budget], now: () => NOW });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RegistrationError);
    const message = (caught as Error).message;
    expect(message).toContain("tally");
    expect(message).toContain("ledger");
    expect(message).toContain("budget");
  });
});
