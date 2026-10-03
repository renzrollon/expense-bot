import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { core } from "../src/core";
import { createGateway } from "../src/gateway";
import type { JobSchedule } from "../src/gateway/registry";
import { scheduler } from "../src/scheduler";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { probeModule } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { insertRun } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

/** 23:00 household time on 30 September. */
const NOW = new Date("2026-09-30T15:00:00.000Z");
const PING_ID = 9100;
const PING_MESSAGE_ID = 78;
const DAILY_21: JobSchedule = { every: "day", hour: 21 };
/** The gateway's own /ping lines come before the scheduler's. */
const GATEWAY_LINES = 4;

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

/** Sends /ping with the jobs registered by a probe module, and returns the lines after the gateway's own. */
async function pingLines(
  jobs: { name: string; schedule: JobSchedule }[],
  testEnv: Env = env,
): Promise<string[]> {
  const probe = probeModule({ jobs });
  const gateway = createGateway({ modules: [core, scheduler, probe.module], now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(
    signedRequest(messageUpdate({ text: "/ping", updateId: PING_ID, messageId: PING_MESSAGE_ID })),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  const sends = telegram.callsTo("sendMessage");
  expect(sends).toHaveLength(1);
  const lines = (sends[0]?.payload as { text: string }).text.split("\n");
  expect(lines[0]).toBe("🏓 expense-bot 0.1.0");
  return lines.slice(GATEWAY_LINES);
}

/** An ISO time `minutes` before NOW. */
function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("The system SHALL show each job's last run in /ping", () => {
  it("Happy path — one line per job", async () => {
    await insertRun(env.DB, { job: "nightly", scheduledDate: "2026-09-30", status: "done" });

    const lines = await pingLines([
      { name: "nightly", schedule: DAILY_21 },
      { name: "digest", schedule: { every: "week", weekday: 7, hour: 19 } },
    ]);

    expect(lines).toEqual(["Job nightly: done · Sep 30 21:00", "Job digest: not run yet"]);
  });

  // This test already passes against the stub: the stub's `not implemented` error
  // takes the same path as a failed read, so the gateway shows the same line.
  it("Failure — the run records cannot be read", async () => {
    await insertRun(env.DB, { job: "nightly", scheduledDate: "2026-09-30", status: "done" });
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql.includes("job_runs"));

    const lines = await pingLines([{ name: "nightly", schedule: DAILY_21 }], { ...env, DB: failing.db });

    expect(lines).toEqual(["scheduler: status unavailable"]);
  });

  it("Edge case — states, counts and the latest record", async () => {
    await insertRun(env.DB, { job: "a", status: "failed", attempts: 1 });
    await insertRun(env.DB, { job: "b", status: "failed", attempts: 2, lastError: "Network request for 'sendMessage' failed!" });
    await insertRun(env.DB, { job: "c", status: "running", startedAt: minutesBefore(45) });
    await insertRun(env.DB, { job: "d", scheduledDate: "2026-09-29", status: "done" });
    await insertRun(env.DB, { job: "d", scheduledDate: "2026-09-30", status: "skipped" });
    await insertRun(env.DB, { job: "old", scheduledDate: "2026-09-30", status: "done" });

    const lines = await pingLines(["a", "b", "c", "d"].map((name) => ({ name, schedule: DAILY_21 })));

    expect(lines).toEqual([
      "Job a: failed · Sep 30 21:00 · 1 attempt",
      "Job b: failed · Sep 30 21:00 · 2 attempts · Network request for 'sendMessage' failed!",
      "Job c: interrupted · Sep 30 21:00",
      "Job d: skipped · Sep 30 21:00",
    ]);
  });

  it("Edge case — no job registered", async () => {
    await insertRun(env.DB, { job: "old", scheduledDate: "2026-09-30", status: "done" });

    const lines = await pingLines([]);

    expect(lines).toEqual(["Jobs: none registered"]);
  });
});
