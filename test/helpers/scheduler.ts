import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { MockInstance } from "vitest";
import type { Scheduler } from "../../src/scheduler";
import type { RunStatus } from "../../src/scheduler/store";

/** One `job_runs` row, with camelCase names. */
export interface JobRunRow {
  job: string;
  scheduledDate: string;
  scheduledHour: number;
  status: RunStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Fires one tick scheduled at `iso` and waits for everything it started. */
export async function tick(scheduler: Scheduler, iso: string, testEnv: Env = env): Promise<void> {
  const controller = createScheduledController({ scheduledTime: new Date(iso) });
  const ctx = createExecutionContext();
  await scheduler.scheduled(controller, testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

/**
 * Writes one `job_runs` row. Fields left out default to a `done` run of `nightly`
 * for 2026-09-30 at 21, created at the 21:00 Manila tick. Attempts, the start time
 * and the finish time default to values that satisfy the table's checks for the status.
 */
export async function insertRun(db: D1Database, row: Partial<JobRunRow> = {}): Promise<void> {
  const status = row.status ?? "done";
  const createdAt = row.createdAt ?? "2026-09-30T13:00:00.000Z";
  const full: JobRunRow = {
    job: row.job ?? "nightly",
    scheduledDate: row.scheduledDate ?? "2026-09-30",
    scheduledHour: row.scheduledHour ?? 21,
    status,
    attempts: row.attempts ?? (status === "skipped" ? 0 : 1),
    lastError: row.lastError ?? null,
    createdAt,
    startedAt: row.startedAt !== undefined ? row.startedAt : status === "skipped" ? null : createdAt,
    finishedAt:
      row.finishedAt !== undefined ? row.finishedAt : status === "done" || status === "failed" ? createdAt : null,
  };
  await db
    .prepare(
      `INSERT INTO job_runs (job, scheduled_date, scheduled_hour, status, attempts, last_error, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      full.job,
      full.scheduledDate,
      full.scheduledHour,
      full.status,
      full.attempts,
      full.lastError,
      full.createdAt,
      full.startedAt,
      full.finishedAt,
    )
    .run();
}

/** The `job_runs` row for `job` and `date`, with camelCase names, or null when none exists. */
export async function readRun(db: D1Database, job: string, date: string): Promise<JobRunRow | null> {
  return db
    .prepare(
      `SELECT job, scheduled_date AS scheduledDate, scheduled_hour AS scheduledHour, status, attempts,
              last_error AS lastError, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
       FROM job_runs WHERE job = ? AND scheduled_date = ?`,
    )
    .bind(job, date)
    .first<JobRunRow>();
}

/** Each line captured by a `console.log` spy, parsed as JSON. A line that is not JSON is kept as `unparsed`. */
export function logEntries(spy: MockInstance<typeof console.log>): Record<string, unknown>[] {
  return spy.mock.calls.map((args) => {
    try {
      return JSON.parse(String(args[0])) as Record<string, unknown>;
    } catch {
      return { unparsed: String(args[0]) };
    }
  });
}
