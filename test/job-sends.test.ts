import { env } from "cloudflare:workers";
import { Api } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { sendOnce, type SendKey, type SendOutcome } from "../src/scheduler/sends";
import { BOT_TOKEN } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { logEntries } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";

useCleanTables(env.DB);

const CHAT = -1001;
const NOW = new Date("2026-09-30T13:00:00.000Z");

interface JobSendRow {
  job: string;
  scheduled_date: string;
  part: string;
  chat_id: number;
  message_id: number;
  sent_at: string;
}

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let nextMessageId: number;

beforeEach(() => {
  telegram = installTelegramStub();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  nextMessageId = 501;
});

afterEach(() => {
  telegram.restore();
  logSpy.mockRestore();
});

/** Sends `text` to the chat through the Telegram stub, each message with the next message id. */
async function sendText(text: string) {
  telegram.setResult("sendMessage", {
    message_id: nextMessageId++,
    date: Math.floor(NOW.getTime() / 1000),
    chat: { id: CHAT, type: "supergroup", title: "Household" },
    text,
  });
  return new Api(BOT_TOKEN).sendMessage(CHAT, text);
}

/** The job `hello`: it sends `hi` through the send record with the part `greeting`. */
function hello(scheduledDate: string, db: D1Database = env.DB): Promise<SendOutcome> {
  return sendOnce(db, { job: "hello", scheduledDate, part: "greeting" }, NOW, () => sendText("hi"));
}

async function readSend(key: SendKey): Promise<JobSendRow | null> {
  return env.DB.prepare("SELECT * FROM job_sends WHERE job = ? AND scheduled_date = ? AND part = ?")
    .bind(key.job, key.scheduledDate, key.part)
    .first<JobSendRow>();
}

async function countSends(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_sends").first<{ n: number }>();
  return row?.n ?? -1;
}

const GREETING: SendKey = { job: "hello", scheduledDate: "2026-09-30", part: "greeting" };

describe("The system SHALL let a job send each message once per scheduled date", () => {
  it("Happy path — a second run sends nothing", async () => {
    expect(await hello("2026-09-30")).toBe("sent");
    expect(telegram.callsTo("sendMessage")).toHaveLength(1);

    expect(await hello("2026-09-30")).toBe("already_sent");
    expect(telegram.callsTo("sendMessage")).toHaveLength(1);
    expect(await readSend(GREETING)).toEqual({
      job: "hello",
      scheduled_date: "2026-09-30",
      part: "greeting",
      chat_id: CHAT,
      message_id: 501,
      sent_at: NOW.toISOString(),
    });
  });

  it("Failure — the send fails", async () => {
    telegram.failNext("sendMessage");
    await expect(hello("2026-09-30")).rejects.toThrow(/Internal Server Error: injected/);
    expect(await readSend(GREETING)).toBeNull();

    expect(await hello("2026-09-30")).toBe("sent");
    const delivered = telegram.callsTo("sendMessage").filter((call) => call.failed !== true);
    expect(delivered).toHaveLength(1);
    expect(await readSend(GREETING)).not.toBeNull();
  });

  it("Edge case — the record cannot be saved", async () => {
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql.startsWith("INSERT INTO job_sends"));

    expect(await hello("2026-09-30", failing.db)).toBe("sent");
    expect(telegram.callsTo("sendMessage")).toHaveLength(1);
    expect(await readSend(GREETING)).toBeNull();

    const unsaved = logEntries(logSpy).filter((entry) => entry["event"] === "job_send_unsaved");
    expect(unsaved).toEqual([
      { event: "job_send_unsaved", job: "hello", scheduled_date: "2026-09-30", part: "greeting" },
    ]);
    for (const args of logSpy.mock.calls) expect(String(args[0])).not.toContain('"hi"');
  });

  it("Edge case — parts and dates are separate keys", async () => {
    const backup = async (scheduledDate: string): Promise<SendOutcome[]> => [
      await sendOnce(env.DB, { job: "backup", scheduledDate, part: "entries" }, NOW, () => sendText("entries")),
      await sendOnce(env.DB, { job: "backup", scheduledDate, part: "keywords" }, NOW, () => sendText("keywords")),
    ];

    expect(await backup("2026-09-30")).toEqual(["sent", "sent"]);
    expect(await backup("2026-09-30")).toEqual(["already_sent", "already_sent"]);
    expect(await backup("2026-10-01")).toEqual(["sent", "sent"]);

    expect(
      telegram.callsTo("sendMessage").map((call) => (call.payload as { text: string }).text),
    ).toEqual(["entries", "keywords", "entries", "keywords"]);
    expect(await countSends()).toBe(4);
  });

  it("A send that returns null writes no record", async () => {
    let calls = 0;
    const outcome = await sendOnce(env.DB, GREETING, NOW, async () => {
      calls += 1;
      return null;
    });
    expect(outcome).toBe("nothing_to_send");
    expect(calls).toBe(1);
    expect(await countSends()).toBe(0);
    expect(telegram.calls).toEqual([]);
  });
});
