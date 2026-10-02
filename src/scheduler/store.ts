/** A running attempt older than this may be reclaimed by a later tick (Decision 5, D11). */
export const LEASE_MS = 1_800_000;

export type RunStatus = "running" | "done" | "failed" | "skipped";

/** One `job_runs` row, as the scheduler and `/ping` read it (Decision 6). */
export interface RunRecord {
  job: string;
  /** YYYY-MM-DD, household time. */
  scheduledDate: string;
  scheduledHour: number;
  status: RunStatus;
  attempts: number;
  /** ISO-8601 UTC; null only for a skipped record. */
  startedAt: string | null;
}

/** The primary key of a run record. */
type RunKey = Pick<RunRecord, "job" | "scheduledDate">;

interface RunInput extends RunKey {
  scheduledHour: number;
  now: Date;
}

interface RunRow {
  job: string;
  scheduled_date: string;
  status: RunStatus;
  attempts: number;
  started_at: string | null;
}

const ERROR_MAX = 500;

/**
 * Reads the run records for every key in one statement, keyed by `${job}\n${date}`.
 * With no keys it runs no statement.
 */
export async function findRuns(
  db: D1Database,
  keys: RunKey[],
): Promise<Map<string, Omit<RunRecord, "scheduledHour">>> {
  const runs = new Map<string, Omit<RunRecord, "scheduledHour">>();
  if (keys.length === 0) return runs;
  const values = keys.map((_, i) => `(?${2 * i + 1}, ?${2 * i + 2})`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT job, scheduled_date, status, attempts, started_at FROM job_runs
       WHERE (job, scheduled_date) IN (VALUES ${values})`,
    )
    .bind(...keys.flatMap((key) => [key.job, key.scheduledDate]))
    .all<RunRow>();
  for (const row of results) {
    runs.set(`${row.job}\n${row.scheduled_date}`, {
      job: row.job,
      scheduledDate: row.scheduled_date,
      status: row.status,
      attempts: row.attempts,
      startedAt: row.started_at,
    });
  }
  return runs;
}

/** Claims a run in one atomic statement. Returns the attempt number, or null when not claimed. */
export async function claimRun(db: D1Database, input: RunInput): Promise<number | null> {
  const cutoff = new Date(input.now.getTime() - LEASE_MS).toISOString();
  const claimed = await db
    .prepare(
      `INSERT INTO job_runs (job, scheduled_date, scheduled_hour, status, attempts, created_at, started_at)
       VALUES (?1, ?2, ?3, 'running', 1, ?4, ?4)
       ON CONFLICT (job, scheduled_date) DO UPDATE SET
         status = 'running', attempts = job_runs.attempts + 1,
         scheduled_hour = excluded.scheduled_hour, started_at = excluded.started_at, finished_at = NULL
       WHERE job_runs.status = 'failed'
          OR (job_runs.status = 'running' AND job_runs.started_at < ?5)
       RETURNING attempts`,
    )
    .bind(input.job, input.scheduledDate, input.scheduledHour, input.now.toISOString(), cutoff)
    .first<{ attempts: number }>();
  return claimed?.attempts ?? null;
}

/** Records the claimed `attempt` as done. */
export async function finishRun(db: D1Database, key: RunKey, attempt: number, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE job_runs SET status = 'done', finished_at = ?1
       WHERE job = ?2 AND scheduled_date = ?3 AND status = 'running' AND attempts = ?4`,
    )
    .bind(now.toISOString(), key.job, key.scheduledDate, attempt)
    .run();
}

/** Records the claimed `attempt` as failed, with the error message cut to 500 characters. */
export async function failRun(
  db: D1Database,
  key: RunKey,
  attempt: number,
  error: unknown,
  now: Date,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX);
  await db
    .prepare(
      `UPDATE job_runs SET status = 'failed', last_error = ?1, finished_at = ?2
       WHERE job = ?3 AND scheduled_date = ?4 AND status = 'running' AND attempts = ?5`,
    )
    .bind(message, now.toISOString(), key.job, key.scheduledDate, attempt)
    .run();
}

/** Writes a skipped record unless one exists. Returns true only when it wrote the row. */
export async function recordSkipped(db: D1Database, input: RunInput): Promise<boolean> {
  const written = await db
    .prepare(
      `INSERT INTO job_runs (job, scheduled_date, scheduled_hour, status, attempts, created_at)
       VALUES (?1, ?2, ?3, 'skipped', 0, ?4)
       ON CONFLICT (job, scheduled_date) DO NOTHING
       RETURNING job`,
    )
    .bind(input.job, input.scheduledDate, input.scheduledHour, input.now.toISOString())
    .first<{ job: string }>();
  return written !== null;
}

/** The record with the greatest scheduled date for each job. */
export async function latestRuns(db: D1Database): Promise<RunRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT r.job, r.scheduled_date, r.scheduled_hour, r.status, r.attempts, r.started_at
       FROM job_runs AS r
       JOIN (SELECT job, MAX(scheduled_date) AS scheduled_date FROM job_runs GROUP BY job) AS latest
         ON latest.job = r.job AND latest.scheduled_date = r.scheduled_date
       ORDER BY r.job`,
    )
    .all<RunRow & { scheduled_hour: number }>();
  return results.map((row) => ({
    job: row.job,
    scheduledDate: row.scheduled_date,
    scheduledHour: row.scheduled_hour,
    status: row.status,
    attempts: row.attempts,
    startedAt: row.started_at,
  }));
}
