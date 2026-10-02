import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  claimRun,
  failRun,
  findRuns,
  finishRun,
  latestRuns,
  LEASE_MS,
  recordSkipped,
  type RunRecord,
} from "../src/scheduler/store";
import { failingDb, useCleanTables } from "./helpers/db";
import { insertRun, readRun, type JobRunRow } from "./helpers/scheduler";

const db = env.DB;
/** The 22:00 Manila tick, one hour after the 21:00 slot. */
const NOW = new Date("2026-09-30T14:00:00.000Z");
const KEY = { job: "nightly", scheduledDate: "2026-09-30" };
const INPUT = { ...KEY, scheduledHour: 21, now: NOW };
const CHECK_FAILED = /CHECK constraint failed/;

/** An ISO time `ms` before NOW. */
function before(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const MINUTE = 60_000;

useCleanTables(db);

/** A database that records the SQL text of every statement it runs. */
function recordingDb(): { db: D1Database; statements: string[] } {
  const statements: string[] = [];
  const failing = failingDb(env.DB);
  failing.failWhen((sql) => {
    statements.push(sql);
    return false;
  });
  return { db: failing.db, statements };
}

describe("findRuns", () => {
  it("returns an empty map for no keys, and runs no statement", async () => {
    const failing = failingDb(env.DB);
    failing.failAll();

    const runs = await findRuns(failing.db, []);

    expect(runs).toBeInstanceOf(Map);
    expect(runs.size).toBe(0);
  });

  it("reads one key", async () => {
    await insertRun(db, { status: "failed", attempts: 2, startedAt: "2026-09-30T13:00:00.000Z" });
    await insertRun(db, { scheduledDate: "2026-09-29" });

    const runs = await findRuns(db, [KEY]);

    expect([...runs.entries()]).toEqual([
      [
        "nightly\n2026-09-30",
        {
          job: "nightly",
          scheduledDate: "2026-09-30",
          status: "failed",
          attempts: 2,
          startedAt: "2026-09-30T13:00:00.000Z",
        },
      ],
    ]);
  });

  it("reads three keys in one statement that matches (job, scheduled_date) pairs", async () => {
    await insertRun(db, { job: "a", scheduledDate: "2026-09-30", status: "done" });
    await insertRun(db, { job: "b", scheduledDate: "2026-09-27", status: "skipped" });
    await insertRun(db, { job: "c", scheduledDate: "2026-10-01", status: "running", startedAt: before(10 * MINUTE) });
    // Each decoy matches one key's job and another key's date, but no key as a pair.
    await insertRun(db, { job: "a", scheduledDate: "2026-09-27" });
    await insertRun(db, { job: "b", scheduledDate: "2026-10-01" });
    await insertRun(db, { job: "c", scheduledDate: "2026-09-30" });
    const recording = recordingDb();

    const runs = await findRuns(recording.db, [
      { job: "a", scheduledDate: "2026-09-30" },
      { job: "b", scheduledDate: "2026-09-27" },
      { job: "c", scheduledDate: "2026-10-01" },
    ]);

    expect(recording.statements).toHaveLength(1);
    expect(recording.statements[0]).toContain(
      "WHERE (job, scheduled_date) IN (VALUES (?1, ?2), (?3, ?4), (?5, ?6))",
    );
    expect(new Map([...runs].sort(([x], [y]) => x.localeCompare(y)))).toEqual(
      new Map([
        ["a\n2026-09-30", { job: "a", scheduledDate: "2026-09-30", status: "done", attempts: 1, startedAt: "2026-09-30T13:00:00.000Z" }],
        ["b\n2026-09-27", { job: "b", scheduledDate: "2026-09-27", status: "skipped", attempts: 0, startedAt: null }],
        ["c\n2026-10-01", { job: "c", scheduledDate: "2026-10-01", status: "running", attempts: 1, startedAt: before(10 * MINUTE) }],
      ]),
    );
  });

  it("leaves out a key that has no record", async () => {
    await insertRun(db, { job: "a", scheduledDate: "2026-09-30" });

    const runs = await findRuns(db, [
      { job: "a", scheduledDate: "2026-09-30" },
      { job: "b", scheduledDate: "2026-09-30" },
      { job: "a", scheduledDate: "2026-10-01" },
    ]);

    expect([...runs.keys()]).toEqual(["a\n2026-09-30"]);
  });
});

describe("claimRun", () => {
  it("claims attempt 1 when no record exists", async () => {
    expect(await claimRun(db, INPUT)).toBe(1);

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual<JobRunRow>({
      job: "nightly",
      scheduledDate: "2026-09-30",
      scheduledHour: 21,
      status: "running",
      attempts: 1,
      lastError: null,
      createdAt: NOW.toISOString(),
      startedAt: NOW.toISOString(),
      finishedAt: null,
    });
  });

  it("claims the next attempt of a failed record, keeping its creation time and last error", async () => {
    await insertRun(db, { status: "failed", attempts: 1, lastError: "network down" });

    expect(await claimRun(db, { ...INPUT, scheduledHour: 20 })).toBe(2);

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual<JobRunRow>({
      job: "nightly",
      scheduledDate: "2026-09-30",
      scheduledHour: 20,
      status: "running",
      attempts: 2,
      lastError: "network down",
      createdAt: "2026-09-30T13:00:00.000Z",
      startedAt: NOW.toISOString(),
      finishedAt: null,
    });
  });

  it("reclaims a running record started just over the lease before now", async () => {
    await insertRun(db, { status: "running", attempts: 1, startedAt: before(LEASE_MS + 1) });

    expect(await claimRun(db, INPUT)).toBe(2);

    const row = await readRun(db, "nightly", "2026-09-30");
    expect(row).toMatchObject({ status: "running", attempts: 2, startedAt: NOW.toISOString(), finishedAt: null });
  });

  it.each<[string, Partial<JobRunRow>]>([
    ["running, started exactly the lease before now", { status: "running", startedAt: before(LEASE_MS) }],
    ["running, started 10 minutes before now", { status: "running", startedAt: before(10 * MINUTE) }],
    ["done", { status: "done" }],
    ["skipped", { status: "skipped" }],
  ])("does not claim a record that is %s, and leaves it unchanged", async (_label, fields) => {
    await insertRun(db, fields);
    const stored = await readRun(db, "nightly", "2026-09-30");

    expect(await claimRun(db, INPUT)).toBeNull();

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(stored);
  });

  it("is keyed by job and scheduled date", async () => {
    await insertRun(db, { status: "done" });
    await insertRun(db, { job: "digest", status: "done" });

    expect(await claimRun(db, { ...INPUT, scheduledDate: "2026-10-01" })).toBe(1);
    expect(await claimRun(db, { ...INPUT, job: "recap" })).toBe(1);
  });
});

describe("finishRun", () => {
  it("records its own attempt as done and keeps the last error", async () => {
    await insertRun(db, { status: "running", attempts: 2, lastError: "network down", startedAt: before(5 * MINUTE) });

    await finishRun(db, KEY, 2, NOW);

    expect(await readRun(db, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 2,
      lastError: "network down",
      startedAt: before(5 * MINUTE),
      finishedAt: NOW.toISOString(),
    });
  });

  it.each<[string, Partial<JobRunRow>]>([
    ["a later attempt holds the claim", { status: "running", attempts: 3, startedAt: before(5 * MINUTE) }],
    ["the attempt already failed", { status: "failed", attempts: 2 }],
  ])("changes nothing when %s", async (_label, fields) => {
    await insertRun(db, fields);
    const stored = await readRun(db, "nightly", "2026-09-30");

    await finishRun(db, KEY, 2, NOW);

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(stored);
  });

  it("closes only its own key", async () => {
    await insertRun(db, { status: "running", attempts: 1 });
    await insertRun(db, { job: "digest", status: "running", attempts: 1 });

    await finishRun(db, KEY, 1, NOW);

    expect((await readRun(db, "nightly", "2026-09-30"))?.status).toBe("done");
    expect((await readRun(db, "digest", "2026-09-30"))?.status).toBe("running");
  });
});

describe("failRun", () => {
  it("records its own attempt as failed with the error message", async () => {
    await insertRun(db, { status: "running", attempts: 1 });

    await failRun(db, KEY, 1, new Error("network down"), NOW);

    expect(await readRun(db, "nightly", "2026-09-30")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "network down",
      finishedAt: NOW.toISOString(),
    });
  });

  it.each<[string, Partial<JobRunRow>]>([
    ["a later attempt holds the claim", { status: "running", attempts: 3, startedAt: before(5 * MINUTE) }],
    ["the attempt is already done", { status: "done", attempts: 2 }],
  ])("changes nothing when %s", async (_label, fields) => {
    await insertRun(db, fields);
    const stored = await readRun(db, "nightly", "2026-09-30");

    await failRun(db, KEY, 2, new Error("late"), NOW);

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(stored);
  });

  it("cuts the message to its first 500 characters", async () => {
    await insertRun(db, { status: "running", attempts: 1 });

    await failRun(db, KEY, 1, new Error("x".repeat(500) + "y".repeat(100)), NOW);

    expect((await readRun(db, "nightly", "2026-09-30"))?.lastError).toBe("x".repeat(500));
  });

  it.each<[string, unknown, string]>([
    ["a string", "No allowed chat id is stored", "No allowed chat id is stored"],
    ["a number", 42, "42"],
    ["an object with toString", { toString: () => "custom failure" }, "custom failure"],
  ])("keeps String(error) for %s", async (_label, error, expected) => {
    await insertRun(db, { status: "running", attempts: 1 });

    await failRun(db, KEY, 1, error, NOW);

    expect((await readRun(db, "nightly", "2026-09-30"))?.lastError).toBe(expected);
  });
});

describe("recordSkipped", () => {
  it("writes a skipped record once, returning true and then false", async () => {
    expect(await recordSkipped(db, INPUT)).toBe(true);
    const written: JobRunRow = {
      job: "nightly",
      scheduledDate: "2026-09-30",
      scheduledHour: 21,
      status: "skipped",
      attempts: 0,
      lastError: null,
      createdAt: NOW.toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(written);

    expect(await recordSkipped(db, { ...INPUT, now: new Date("2026-09-30T15:00:00.000Z") })).toBe(false);
    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(written);
  });

  it("returns false and leaves a failed record unchanged", async () => {
    await insertRun(db, { status: "failed", attempts: 3, lastError: "boom" });
    const stored = await readRun(db, "nightly", "2026-09-30");

    expect(await recordSkipped(db, INPUT)).toBe(false);

    expect(await readRun(db, "nightly", "2026-09-30")).toEqual(stored);
  });
});

describe("latestRuns", () => {
  it("returns no records for an empty table", async () => {
    expect(await latestRuns(db)).toEqual([]);
  });

  it("returns the record with the greatest scheduled date for each job", async () => {
    await insertRun(db, { job: "nightly", scheduledDate: "2026-09-29", status: "done" });
    await insertRun(db, { job: "nightly", scheduledDate: "2026-09-30", status: "failed", attempts: 2 });
    await insertRun(db, { job: "nightly", scheduledDate: "2026-09-28", status: "done" });
    await insertRun(db, { job: "digest", scheduledDate: "2026-10-04", scheduledHour: 19, status: "running", startedAt: before(MINUTE) });
    await insertRun(db, { job: "digest", scheduledDate: "2026-09-27", scheduledHour: 19, status: "skipped" });

    const runs = [...(await latestRuns(db))].sort((x, y) => x.job.localeCompare(y.job));

    expect(runs).toEqual<RunRecord[]>([
      { job: "digest", scheduledDate: "2026-10-04", scheduledHour: 19, status: "running", attempts: 1, startedAt: before(MINUTE) },
      { job: "nightly", scheduledDate: "2026-09-30", scheduledHour: 21, status: "failed", attempts: 2, startedAt: "2026-09-30T13:00:00.000Z" },
    ]);
  });
});

// These exercise migration 0004 directly, not the store, so they pass against the stubs.
describe("job_runs checks", () => {
  it.each<[string, Partial<JobRunRow>]>([
    ["an empty job name", { job: "" }],
    ["a job name of 33 characters", { job: "a".repeat(33) }],
    ["a scheduled date that is not YYYY-MM-DD", { scheduledDate: "2026-9-30" }],
    ["a scheduled hour of 24", { scheduledHour: 24 }],
    ["an unknown status", { status: "queued" as JobRunRow["status"] }],
    ["negative attempts", { attempts: -1 }],
    ["a skipped record with an attempt", { status: "skipped", attempts: 1 }],
    ["a done record with no attempt", { status: "done", attempts: 0 }],
    ["a done record with no start time", { status: "done", startedAt: null }],
  ])("rejects %s", async (_label, fields) => {
    await expect(insertRun(db, fields)).rejects.toThrow(CHECK_FAILED);
  });
});
