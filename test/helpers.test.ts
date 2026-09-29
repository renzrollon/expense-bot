import { env } from "cloudflare:workers";
import { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOT_INFO, BOT_TOKEN, BOT_USERNAME, SECRET_HEADER, WEBHOOK_SECRET } from "./helpers/constants";
import { failingDb, normalizeSql, useCleanTables } from "./helpers/db";
import { probeModule } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import {
  callbackUpdate,
  editedMessageUpdate,
  messageUpdate,
  photoUpdate,
} from "./helpers/updates";
import type { BotContext } from "../src/gateway/registry";

useCleanTables(env.DB);

let telegram: TelegramStub;
beforeEach(() => {
  telegram = installTelegramStub();
});
afterEach(() => {
  telegram.restore();
});

function plainBot(): { bot: Bot; seen: string[] } {
  const seen: string[] = [];
  const bot = new Bot(BOT_TOKEN, { botInfo: BOT_INFO });
  bot.command("ping", async (ctx) => {
    seen.push(`command:${ctx.match}`);
    await ctx.reply("pong");
  });
  bot.on("message:caption", async () => {
    seen.push("caption");
  });
  bot.on("edited_message:text", async () => {
    seen.push("edited");
  });
  bot.callbackQuery(/^add:/, async (ctx) => {
    seen.push(`button:${ctx.callbackQuery.data}`);
    await ctx.answerCallbackQuery({ text: "ok" });
  });
  return { bot, seen };
}

describe("update builders and the fetch stub", () => {
  it("matches a command without @username", async () => {
    const { bot, seen } = plainBot();
    await bot.handleUpdate(messageUpdate({ text: "/ping now" }));
    expect(seen).toEqual(["command:now"]);
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0]?.method).toBe("sendMessage");
    expect(telegram.calls[0]?.payload).toMatchObject({ text: "pong" });
  });

  it("derives the bot_command entity to cover the @username", () => {
    const update = messageUpdate({ text: `/ping@${BOT_USERNAME} now` });
    expect(update.message?.entities).toEqual([
      { type: "bot_command", offset: 0, length: `/ping@${BOT_USERNAME}`.length },
    ]);
    expect(messageUpdate({ text: "hello" }).message?.entities).toBeUndefined();
  });

  it("matches a command with its own @username and not another bot's", async () => {
    const { bot, seen } = plainBot();
    await bot.handleUpdate(messageUpdate({ text: `/ping@${BOT_USERNAME}` }));
    await bot.handleUpdate(messageUpdate({ text: "/ping@other_bot", updateId: 2 }));
    expect(seen).toEqual(["command:"]);
  });

  it("builds a photo with a caption and caption entities", async () => {
    const { bot, seen } = plainBot();
    const update = photoUpdate({ caption: "/ping look" });
    expect(update.message?.photo).toHaveLength(1);
    expect(update.message?.caption).toBe("/ping look");
    expect(update.message?.caption_entities).toEqual([
      { type: "bot_command", offset: 0, length: 5 },
    ]);
    await bot.handleUpdate(update);
    expect(seen).toEqual(["caption"]);
    expect(telegram.calls).toHaveLength(0);
  });

  it("builds an edited message", async () => {
    const { bot, seen } = plainBot();
    await bot.handleUpdate(editedMessageUpdate({ text: "/ping fixed" }));
    expect(seen).toEqual(["edited"]);
  });

  it("builds a button press that can be answered", async () => {
    const { bot, seen } = plainBot();
    const update = callbackUpdate({ data: "add:5", updateId: 7 });
    await bot.handleUpdate(update);
    expect(seen).toEqual(["button:add:5"]);
    expect(telegram.calls).toEqual([
      { method: "answerCallbackQuery", payload: { callback_query_id: "cb-7", text: "ok" } },
    ]);
  });

  it("builds a button press with no data", () => {
    expect(callbackUpdate().callback_query?.data).toBeUndefined();
  });

  it("answers with a chosen result for a method", async () => {
    telegram.setResult("getChat", { id: 5 });
    const bot = new Bot(BOT_TOKEN, { botInfo: BOT_INFO });
    expect(await bot.api.getChat(5)).toEqual({ id: 5 });
    expect(telegram.callsTo("getChat")).toEqual([{ method: "getChat", payload: { chat_id: 5 } }]);
  });

  it("restores fetch", () => {
    const stubbed = globalThis.fetch;
    telegram.restore();
    expect(globalThis.fetch).not.toBe(stubbed);
  });
});

describe("signed requests", () => {
  it("carries the secret header, method, path and body", async () => {
    const update = messageUpdate({ text: "hi" });
    const request = signedRequest(update);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/webhook");
    expect(request.headers.get(SECRET_HEADER)).toBe(WEBHOOK_SECRET);
    expect(await request.text()).toBe(JSON.stringify(update));
  });

  it("can leave out or change the header, the method and the path", async () => {
    const update = messageUpdate({ text: "hi" });
    expect(signedRequest(update, { secret: null }).headers.has(SECRET_HEADER)).toBe(false);
    expect(signedRequest(update, { secret: "wrong" }).headers.get(SECRET_HEADER)).toBe("wrong");
    expect(signedRequest(update, { method: "GET" }).method).toBe("GET");
    expect(new URL(signedRequest(update, { path: "/other" }).url).pathname).toBe("/other");
    expect(await signedRequest(update, { body: "not json" }).text()).toBe("not json");
  });
});

describe("failing database proxy", () => {
  const insert = "INSERT INTO settings (key, value, updated_at) VALUES (?, 'v', 't')";

  it("passes statements through until a trigger is set", async () => {
    const { db } = failingDb(env.DB);
    await db.prepare(insert).bind("a").run();
    const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind("a").first<{ value: string }>();
    expect(row?.value).toBe("v");
    const rows = await db.prepare("SELECT key FROM settings").all();
    expect(rows.results).toHaveLength(1);
    expect(await db.prepare("SELECT key FROM settings").raw()).toEqual([["a"]]);
  });

  it("failAll rejects at execution and not at preparation", async () => {
    const proxy = failingDb(env.DB);
    proxy.failAll();
    const statement = proxy.db.prepare("SELECT 1");
    await expect(statement.first()).rejects.toThrow("D1 failure injected");
    await expect(statement.run()).rejects.toThrow();
    await expect(statement.all()).rejects.toThrow();
    await expect(statement.raw()).rejects.toThrow();
    await expect(proxy.db.batch([statement])).rejects.toThrow();
    await expect(proxy.db.exec("SELECT 1")).rejects.toThrow();
    await expect(statement.bind().first()).rejects.toThrow();
  });

  it("failWhen fails only statements the predicate accepts, on normalised text", async () => {
    const proxy = failingDb(env.DB);
    const seen: string[] = [];
    proxy.failWhen((sql) => {
      seen.push(sql);
      return sql.startsWith("INSERT INTO updates");
    });
    await expect(proxy.db.prepare("SELECT   1").first()).resolves.toEqual({ "1": 1 });
    const claim = proxy.db.prepare(
      "  INSERT INTO updates\n   (update_id, kind, chat_id, raw, status, attempts, received_at, claimed_at)\n VALUES (1, 'message', 1, '{}', 'processing', 1, 't', 't')",
    );
    await expect(claim.run()).rejects.toThrow("D1 failure injected");
    await expect(proxy.db.batch([claim])).rejects.toThrow();
    expect(seen).toContain("SELECT 1");
    expect(seen.every((sql) => sql === normalizeSql(sql))).toBe(true);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM updates").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("runs a batch of unfailing statements against the real database", async () => {
    const { db } = failingDb(env.DB);
    await db.batch([db.prepare(insert).bind("x"), db.prepare(insert).bind("y")]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("stops failing after heal", async () => {
    const proxy = failingDb(env.DB);
    proxy.failAll();
    proxy.heal();
    await expect(proxy.db.prepare("SELECT 1").first()).resolves.toEqual({ "1": 1 });
  });
});

describe("probe module", () => {
  const fakeCtx = {} as BotContext;

  it("records each call with its arguments", async () => {
    const probe = probeModule({
      commands: ["add"],
      callbacks: ["pick"],
      messages: ["one"],
      editedMessages: ["one"],
      jobs: [{ name: "daily" }],
      status: ["Line one"],
    });
    const m = probe.module;
    await m.commands?.[0]?.handle(fakeCtx, "5 coffee");
    await m.callbacks?.[0]?.handle(fakeCtx, "7");
    await m.messages?.[0]?.(fakeCtx);
    await m.editedMessages?.[0]?.(fakeCtx);
    expect(m.jobs?.[0]?.schedule).toEqual({ every: "day", hour: 9 });
    expect(await m.status?.(fakeCtx)).toEqual(["Line one"]);
    expect(probe.calls.map((c) => c.handler)).toEqual([
      "command:add",
      "callback:pick",
      "message:one",
      "edited:one",
      "status",
    ]);
    expect(probe.callsTo("command:add")[0]?.args).toEqual([fakeCtx, "5 coffee"]);
    expect(probe.callsTo("callback:pick")[0]?.args).toEqual([fakeCtx, "7"]);
  });

  it("omits status unless lines are given", () => {
    expect(probeModule().module.status).toBeUndefined();
  });

  it("fails on demand with the given error, after recording", async () => {
    const probe = probeModule({ commands: ["add", "list"] });
    const error = new Error("boom");
    probe.failWith(error, "command:add");
    await expect(probe.module.commands?.[0]?.handle(fakeCtx, "")).rejects.toBe(error);
    await expect(probe.module.commands?.[1]?.handle(fakeCtx, "")).resolves.toBeUndefined();
    expect(probe.calls).toHaveLength(2);
    probe.failWith(error);
    await expect(probe.module.commands?.[1]?.handle(fakeCtx, "")).rejects.toBe(error);
    probe.clearFailure();
    await expect(probe.module.commands?.[1]?.handle(fakeCtx, "")).resolves.toBeUndefined();
  });
});
