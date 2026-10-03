import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { core } from "../src/core";
import { createGateway } from "../src/gateway";
import type { FeatureModule } from "../src/gateway/registry";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { probeModule } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

const NOW = new Date("2026-09-29T11:00:00.000Z");
const PING_ID = 9000;
const PING_MESSAGE_ID = 77;
const DATABASE_LINE = /^Database: ok · \d+ ms$/;
const HELP_LINES = ["Commands", "/ping · bot status", "/help · this list"];

useCleanTables(env.DB);

let telegram: TelegramStub;
beforeEach(async () => {
  telegram = installTelegramStub();
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), NOW.toISOString())
    .run();
});
afterEach(() => {
  telegram.restore();
});

async function send(modules: FeatureModule[], update: Update, testEnv: Env = env): Promise<Response> {
  const gateway = createGateway({ modules, now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function command(text: string, updateId = PING_ID): Update {
  return messageUpdate({ text, updateId, messageId: PING_MESSAGE_ID });
}

async function insertRecord(updateId: number, status: string, receivedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, received_at, claimed_at)
     VALUES (?, 'message', ?, ?, '{}', ?, ?, ?, ?)`,
  )
    .bind(updateId, ALLOWED_CHAT_ID, MEMBER_A.id, status, status === "parked" ? 3 : 1, receivedAt, receivedAt)
    .run();
}

interface Reply {
  text: string;
  lines: string[];
  replyTo: unknown;
  sentWithoutReply: unknown;
  chatId: unknown;
}

/** The single sendMessage call, which the test expects to be the only one. */
function onlyReply(): Reply {
  const sends = telegram.callsTo("sendMessage");
  expect(sends).toHaveLength(1);
  const payload = sends[0]?.payload as {
    text: string;
    chat_id: unknown;
    reply_parameters?: { message_id?: unknown; allow_sending_without_reply?: unknown };
  };
  return {
    text: payload.text,
    lines: payload.text.split("\n"),
    replyTo: payload.reply_parameters?.message_id,
    sentWithoutReply: payload.reply_parameters?.allow_sending_without_reply,
    chatId: payload.chat_id,
  };
}

async function ping(modules: FeatureModule[] = [core]): Promise<Reply> {
  const response = await send(modules, command("/ping"));
  expect(response.status).toBe(200);
  return onlyReply();
}

describe("Ping command", () => {
  it("Healthy bot", async () => {
    await insertRecord(8000, "done", "2026-09-29T10:05:00.000Z");

    const reply = await ping();

    expect(reply.replyTo).toBe(PING_MESSAGE_ID);
    expect(reply.sentWithoutReply).toBe(true);
    expect(reply.chatId).toBe(ALLOWED_CHAT_ID);
    expect(reply.lines).toHaveLength(4);
    expect(reply.lines[0]).toBe("🏓 expense-bot 0.1.0");
    expect(reply.lines[1]).toMatch(DATABASE_LINE);
    expect(reply.lines[2]).toBe("Last update: Sep 29, 18:05");
    expect(reply.lines[3]).toBe("Parked updates: none");
  });

  it("No earlier update", async () => {
    const reply = await ping();

    expect(reply.lines[2]).toBe("Last update: none yet");
  });

  it("Parked updates exist", async () => {
    await insertRecord(1001, "parked", "2026-09-29T09:00:00.000Z");
    await insertRecord(1002, "parked", "2026-09-29T09:30:00.000Z");

    const reply = await ping();

    expect(reply.lines[3]).toBe("Parked updates: 2 · 1002, 1001");
  });

  it("Most recent parked update has the lowest id", async () => {
    await insertRecord(5000, "parked", "2026-09-29T09:00:00.000Z");
    await insertRecord(17, "parked", "2026-09-29T09:30:00.000Z");

    const reply = await ping();

    expect(reply.lines[3]).toBe("Parked updates: 2 · 17, 5000");
  });

  it("Parked updates received at the same time", async () => {
    await insertRecord(1001, "parked", "2026-09-29T09:00:00.000Z");
    await insertRecord(1002, "parked", "2026-09-29T09:00:00.000Z");

    const reply = await ping();

    expect(reply.lines[3]).toBe("Parked updates: 2 · 1002, 1001");
  });

  it("More than five parked updates", async () => {
    const idsInOrderReceived = [11, 5, 23, 8, 42, 3, 19];
    for (const [i, id] of idsInOrderReceived.entries()) {
      await insertRecord(id, "parked", new Date(Date.UTC(2026, 8, 29, 9, i)).toISOString());
    }

    const reply = await ping();

    expect(reply.lines[3]).toBe("Parked updates: 7 · 19, 3, 42, 8, 23");
  });

  it("Time is shown in the household timezone", async () => {
    await insertRecord(8000, "done", "2026-09-29T16:30:00.000Z");
    const later = new Date("2026-09-29T17:00:00.000Z");
    const gateway = createGateway({ modules: [core], now: () => later });
    const ctx = createExecutionContext();

    const response = await gateway.fetch(signedRequest(command("/ping")), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(onlyReply().lines[2]).toBe("Last update: Sep 30, 00:30");
  });

  it("Day below ten", async () => {
    await insertRecord(8000, "done", "2026-09-04T23:07:00.000Z");

    const reply = await ping();

    expect(reply.lines[2]).toBe("Last update: Sep 5, 07:07");
  });

  it("Module adds status lines", async () => {
    const probe = probeModule({ name: "scheduler", status: ["Jobs: none run yet"] });

    const reply = await ping([core, probe.module]);

    expect(reply.lines).toHaveLength(5);
    expect(reply.lines[4]).toBe("Jobs: none run yet");
  });

  it("Module status fails", async () => {
    const probe = probeModule({ name: "scheduler", status: ["Jobs: none run yet"] });
    probe.failWith(new Error("status broke"), "status");

    const reply = await ping([core, probe.module]);

    expect(reply.lines).toHaveLength(5);
    expect(reply.lines[1]).toMatch(DATABASE_LINE);
    expect(reply.lines[4]).toBe("scheduler: status unavailable");
    const row = await env.DB.prepare("SELECT status FROM updates WHERE update_id = ?")
      .bind(PING_ID)
      .first<{ status: string }>();
    expect(row?.status).toBe("done");
  });

  it("Database check fails", async () => {
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql === "SELECT 1");

    const response = await send([core], command("/ping"), { ...env, DB: failing.db });

    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(telegram.callsTo("sendMessage")).toEqual([]);
    const row = await env.DB.prepare("SELECT status FROM updates WHERE update_id = ?")
      .bind(PING_ID)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
  });
});

describe("Help command", () => {
  it("Help lists the registered commands", async () => {
    const response = await send([core], command("/help"));

    expect(response.status).toBe(200);
    const reply = onlyReply();
    expect(reply.replyTo).toBe(PING_MESSAGE_ID);
    expect(reply.sentWithoutReply).toBe(true);
    expect(reply.lines).toEqual(HELP_LINES);
  });

  it("Help includes a new module's command", async () => {
    const today: FeatureModule = {
      name: "today",
      commands: [{ name: "today", description: "spending today", handle: async () => {} }],
    };

    const response = await send([core, today], command("/help"));

    expect(response.status).toBe(200);
    const { lines } = onlyReply();
    expect(lines).toContain("/today · spending today");
    expect(lines.indexOf("/today · spending today")).toBeGreaterThan(lines.indexOf("/help · this list"));
    expect(lines.indexOf("/help · this list")).toBeGreaterThan(lines.indexOf("/ping · bot status"));
  });

  it("Module without commands", async () => {
    const quiet = probeModule({ name: "quiet", messages: ["any"] });

    const response = await send([core, quiet.module], command("/help"));

    expect(response.status).toBe(200);
    expect(onlyReply().lines).toEqual(HELP_LINES);
  });
});

describe("Feature module registration", () => {
  it("Module is added", async () => {
    const probe = probeModule({ name: "today", commands: ["today"] });
    const modules = [core, probe.module];

    const run = await send(modules, command("/today", 9101));
    const help = await send(modules, command("/help", 9102));

    expect(run.status).toBe(200);
    expect(help.status).toBe(200);
    expect(probe.callsTo("command:today")).toHaveLength(1);
    expect(onlyReply().lines).toContain("/today · Probe command today");
  });
});
