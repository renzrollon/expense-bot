import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

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

describe("Feature module registration", () => {
  it("Deployed bot uses the registration list", async () => {
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      signedRequest(messageUpdate({ text: "/help", updateId: 1, messageId: 55 })),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const sends = telegram.callsTo("sendMessage");
    expect(sends).toHaveLength(1);
    const payload = sends[0]?.payload as { text: string; reply_parameters?: { message_id?: number } };
    expect(payload.reply_parameters?.message_id).toBe(55);
    const lines = payload.text.split("\n");
    expect(lines).toContain("/ping · bot status");
    expect(lines).toContain("/help · this list");
  });
});
