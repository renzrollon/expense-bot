import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { core } from "../src/core";
import { createGateway } from "../src/gateway";
import { addMessageEntries } from "../src/ledger";
import { reports } from "../src/reports";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramCall, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

/** 10:00 on Tuesday 2026-09-29 in Manila. */
const TUESDAY = new Date("2026-09-29T02:00:00.000Z");
const RETRY_AFTER_MS = 5_000;
const COMMAND_MESSAGE_ID = 60;

const FULL_WEEK_REPORT = [
  "📊 This week · Sep 28 to Sep 29",
  "₱8,450 · 23 entries",
  "",
  "🛒 Groceries · ₱3,200 · 38%",
  "🍽 Dining · ₱2,150 · 25%",
  "🚗 Transport · ₱1,300 · 15%",
  "💡 Bills · ₱1,100 · 13%",
  "❓ Other · ₱700 · 8%",
  "",
  "Not counted: 🔁 Transfers ₱2,000",
].join("\n");

interface SendPayload {
  chat_id?: unknown;
  text: string;
  parse_mode?: unknown;
  reply_parameters?: { message_id?: unknown };
  link_preview_options?: unknown;
}

useCleanTables(env.DB);

let telegram: TelegramStub;
let now: Date;
let nextUpdateId: number;
let nextSourceMessageId: number;

beforeEach(async () => {
  telegram = installTelegramStub();
  now = TUESDAY;
  nextUpdateId = 800;
  nextSourceMessageId = 1;
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), TUESDAY.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
});

function gatewayWith() {
  return createGateway({ modules: [core, reports], now: () => now });
}

function command(text: string, updateId = nextUpdateId++): Update {
  return messageUpdate({
    text,
    updateId,
    messageId: COMMAND_MESSAGE_ID,
    date: Math.floor(now.getTime() / 1000),
  });
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

/** Ana sends the command; the attempt must succeed. */
async function send(text: string): Promise<void> {
  const response = await deliver(command(text));
  expect(response.status).toBe(200);
}

/** The sendMessage calls that Telegram accepted. */
function sent(): TelegramCall[] {
  return telegram.callsTo("sendMessage").filter((call) => !call.failed);
}

/** A plain-text reply to the command, with link previews off. */
function replyText(call: TelegramCall | undefined): string {
  expect(call).toBeDefined();
  const payload = call?.payload as SendPayload;
  expect(payload.chat_id).toBe(ALLOWED_CHAT_ID);
  expect(payload.reply_parameters?.message_id).toBe(COMMAND_MESSAGE_ID);
  expect(payload.link_preview_options).toEqual({ is_disabled: true });
  expect(payload).not.toHaveProperty("parse_mode");
  return payload.text;
}

/** The one accepted reply. */
function onlyReply(): string {
  const calls = sent();
  expect(calls).toHaveLength(1);
  return replyText(calls[0]);
}

/** Stores one active entry through the ledger, as its own message. */
async function store(spentOn: string, categoryId: string, pesos: number): Promise<void> {
  await addMessageEntries(env.DB, {
    chatId: ALLOWED_CHAT_ID,
    sourceMessageId: nextSourceMessageId++,
    payerUserId: MEMBER_A.id,
    byUserId: MEMBER_A.id,
    rawText: `${categoryId} ${pesos}`,
    parser: "rules",
    now: TUESDAY,
    items: [
      {
        amountCentavos: pesos * 100,
        description: categoryId,
        spentOn,
        categoryId,
        categorySource: "keyword",
        checkAmount: false,
      },
    ],
  });
}

/**
 * The example week: 23 counted entries, ₱8,450, of which ₱250 in `dining` is the
 * only one dated 2026-09-29, and ₱2,000 in `transfer`. September holds nothing earlier.
 */
async function storeExampleWeek(): Promise<void> {
  const monday = "2026-09-28";
  for (let i = 0; i < 5; i++) await store(monday, "groceries", 640); // ₱3,200
  for (let i = 0; i < 5; i++) await store(monday, "dining", 380); // ₱1,900
  await store("2026-09-29", "dining", 250); // ₱2,150 in all
  for (let i = 0; i < 5; i++) await store(monday, "transport", 260); // ₱1,300
  for (let i = 0; i < 4; i++) await store(monday, "bills", 275); // ₱1,100
  await store(monday, "other", 200);
  await store(monday, "other", 250);
  await store(monday, "other", 250); // ₱700
  await store(monday, "transfer", 2000);
}

describe("The system SHALL answer /today, /week and /month with a report", () => {
  it("Happy path — /week", async () => {
    await storeExampleWeek();

    await send("/week");

    expect(onlyReply()).toBe(FULL_WEEK_REPORT);
  });

  it("Happy path — /today and /month", async () => {
    await storeExampleWeek();

    await send("/today");
    await send("/month");

    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(replyText(calls[0]).split("\n").slice(0, 2)).toEqual(["📊 Today · Sep 29", "₱250 · 1 entry"]);
    expect(replyText(calls[1]).split("\n").slice(0, 2)).toEqual([
      "📊 This month · Sep 1 to Sep 29",
      "₱8,450 · 23 entries",
    ]);
  });

  it("Failure — the ledger cannot be read", async () => {
    await storeExampleWeek();
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql.includes("FROM expenses"));
    const gateway = gatewayWith();
    const update = command("/week");

    const first = await deliver(update, gateway, { ...env, DB: failing.db });

    expect(first.status).toBe(500);
    expect(telegram.callsTo("sendMessage")).toEqual([]);
    const row = await env.DB.prepare("SELECT status FROM updates WHERE update_id = ?")
      .bind(update.update_id)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");

    failing.heal();
    now = new Date(now.getTime() + RETRY_AFTER_MS);
    const second = await deliver(update, gateway, { ...env, DB: failing.db });

    expect(second.status).toBe(200);
    expect(onlyReply()).toBe(FULL_WEEK_REPORT);
  });

  it("Edge case — the commands are listed in /help", async () => {
    await send("/help");

    const calls = sent();
    expect(calls).toHaveLength(1);
    const lines = (calls[0]?.payload as SendPayload).text.split("\n");
    expect(lines).toContain("/today · spending today");
    expect(lines).toContain("/week · spending this week");
    expect(lines).toContain("/month · spending this month");
  });

  it("Edge case — Monday, and the first of the month", async () => {
    await storeExampleWeek();

    now = new Date("2026-09-28T02:00:00.000Z"); // Monday 10:00 in Manila
    await send("/week");
    now = new Date("2026-10-01T02:00:00.000Z"); // Thursday 10:00 in Manila
    await send("/month");

    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(replyText(calls[0]).split("\n")[0]).toBe("📊 This week · Sep 28");
    expect(replyText(calls[1])).toBe("📊 This month · Oct 1 · no entries");
  });

  it("Edge case — the local date differs from the UTC date", async () => {
    await store("2026-09-29", "dining", 250);
    await store("2026-09-30", "groceries", 900);
    now = new Date("2026-09-29T16:30:00.000Z"); // 00:30 on Wednesday 2026-09-30 in Manila

    await send("/today");

    expect(onlyReply()).toBe(["📊 Today · Sep 30", "₱900 · 1 entry", "", "🛒 Groceries · ₱900 · 100%"].join("\n"));
  });

  it("Edge case — text after the command", async () => {
    await storeExampleWeek();

    await send("/week please");

    expect(onlyReply()).toBe(FULL_WEEK_REPORT);
  });
});
