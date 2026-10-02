import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capture } from "../src/capture";
import { core } from "../src/core";
import { buildRegistry } from "../src/gateway/registry";
import worker from "../src/index";
import { modules } from "../src/modules";
import { EXPORT_DESCRIPTION } from "../src/export/command";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { tick } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate, messageUpdate } from "./helpers/updates";

const HELP_LINES = [
  "Commands",
  "/ping · bot status",
  "/help · this list",
  "/today · spending today",
  "/week · spending this week",
  "/month · spending this month",
  "/undo · remove your last entry",
  "/export · " + EXPORT_DESCRIPTION,
];
const CONFIRMATION_ID = 900;

useCleanTables(env.DB);

let telegram: TelegramStub;
beforeEach(async () => {
  telegram = installTelegramStub();
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), new Date().toISOString())
    .run();
});
afterEach(() => {
  telegram.restore();
});

async function sendToDeployedBot(text: string, updateId: number, messageId: number): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    signedRequest(messageUpdate({ text, updateId, messageId })),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Feature module registration", () => {
  it("Deployed bot uses the registration list", async () => {
    const response = await sendToDeployedBot("/help", 1, 55);

    expect(response.status).toBe(200);
    const sends = telegram.callsTo("sendMessage");
    expect(sends).toHaveLength(1);
    const payload = sends[0]?.payload as { text: string; reply_parameters?: { message_id?: number } };
    expect(payload.reply_parameters?.message_id).toBe(55);
    expect(payload.text.split("\n")).toEqual(HELP_LINES);
  });
});

describe("Capture is registered", () => {
  it("The deployed bot logs an expense", async () => {
    telegram.setResult("sendMessage", {
      message_id: CONFIRMATION_ID,
      date: 1_780_000_000,
      chat: { id: ALLOWED_CHAT_ID, type: "supergroup" },
      text: "",
    });

    const response = await sendToDeployedBot("lunch 250", 2, 56);

    expect(response.status).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT source_message_id, amount_centavos, confirmation_message_id FROM expenses",
    ).all<{ source_message_id: number; amount_centavos: number; confirmation_message_id: number | null }>();
    expect(stored.results).toEqual([
      { source_message_id: 56, amount_centavos: 25000, confirmation_message_id: CONFIRMATION_ID },
    ]);
    expect(telegram.callsTo("sendMessage").filter((call) => !call.failed)).toHaveLength(1);
  });

  it("Capture adds no command", async () => {
    const response = await sendToDeployedBot("/help", 3, 57);

    expect(response.status).toBe(200);
    const sends = telegram.callsTo("sendMessage");
    expect(sends).toHaveLength(1);
    const payload = sends[0]?.payload as { text: string };
    expect(payload.text.split("\n")).toEqual(HELP_LINES);
  });

  it("Capture is the last message handler", () => {
    const coreAt = modules.indexOf(core);
    const captureAt = modules.indexOf(capture);
    expect(coreAt).toBeGreaterThanOrEqual(0);
    expect(captureAt).toBeGreaterThan(coreAt);

    const registry = buildRegistry(modules);
    expect(registry.messages.at(-1)?.module).toBe("capture");
    expect(registry.messages.filter((entry) => entry.module === "capture")).toHaveLength(1);
    expect(registry.commands.filter((entry) => entry.module === "capture")).toEqual([]);
    expect(registry.callbacks.filter((entry) => entry.module === "capture")).toEqual([]);
    expect(registry.editedMessages.filter((entry) => entry.module === "capture")).toEqual([]);
    expect(registry.jobs.filter((entry) => entry.module === "capture")).toEqual([]);
  });
});

describe("The system SHALL run the scheduler from one hourly trigger", () => {
  it("The deployed entry exports a scheduled handler", () => {
    expect(typeof worker.scheduled).toBe("function");
  });

  it("/ping on the deployed bot lists the four jobs in order", async () => {
    const response = await sendToDeployedBot("/ping", 4, 58);

    expect(response.status).toBe(200);
    const sends = telegram.callsTo("sendMessage");
    expect(sends).toHaveLength(1);
    const payload = sends[0]?.payload as { text: string };
    const jobs = payload.text
      .split("\n")
      .filter((line) => line.startsWith("Job "))
      .map((line) => line.slice(4).split(":")[0]);
    expect(jobs).toEqual(["weekly_digest", "monthly_recap", "evening_nudge", "nightly_backup"]);
  });

  it("A tick at 21:00 Manila sends the nudge to the allowed chat", async () => {
    await expect(tick({ scheduled: worker.scheduled }, "2026-09-30T13:00:00Z")).resolves.toBeUndefined();

    const nudges = telegram
      .callsTo("sendMessage")
      .map((call) => call.payload as { chat_id: number; text: string })
      .filter((payload) => payload.text.startsWith("🌙 Nothing logged"));
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.chat_id).toBe(ALLOWED_CHAT_ID);
  });
});

describe("The system SHALL make corrections available in the deployed bot", () => {
  it("Happy path — the command is listed", async () => {
    await sendToDeployedBot("/help", 5, 59);

    const payload = telegram.callsTo("sendMessage")[0]?.payload as { text: string };
    expect(payload.text.split("\n")).toContain("/undo · remove your last entry");
  });

  it("Failure — a prefix that corrections does not own", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      signedRequest(callbackUpdate({ data: "x:7", updateId: 6, messageId: 60 })),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const answers = telegram.callsTo("answerCallbackQuery").map((call) => (call.payload as { text?: string }).text);
    expect(answers).toEqual(["This button no longer works."]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM expenses").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("Edge case — a new message is not handled by corrections", async () => {
    telegram.setResult("sendMessage", {
      message_id: CONFIRMATION_ID,
      date: 1_780_000_000,
      chat: { id: ALLOWED_CHAT_ID, type: "supergroup" },
      text: "",
    });

    await sendToDeployedBot("coffee 80", 7, 61);

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM expenses").first<{ count: number }>();
    expect(count?.count).toBe(1);
    expect(telegram.callsTo("sendMessage").filter((call) => !call.failed)).toHaveLength(1);
    const registry = buildRegistry(modules);
    expect(registry.messages.filter((entry) => entry.module === "corrections")).toEqual([]);
    expect(registry.jobs.filter((entry) => entry.module === "corrections")).toEqual([]);
  });
});
