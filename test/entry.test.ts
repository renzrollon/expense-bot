import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capture } from "../src/capture";
import { core } from "../src/core";
import { buildRegistry } from "../src/gateway/registry";
import worker from "../src/index";
import { modules } from "../src/modules";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

const HELP_LINES = ["Commands", "/ping · bot status", "/help · this list"];
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
