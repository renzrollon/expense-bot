import type { JobRegistration } from "../gateway/registry";
import { LEASE_MS, type RunRecord } from "./store";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The scheduler's `/ping` lines (Decision 9): one per registered job, in
 * registration order, or `Jobs: none registered`.
 */
export function formatStatusLines(
  jobs: readonly Pick<JobRegistration, "name">[],
  runs: RunRecord[],
  now: Date,
): string[] {
  if (jobs.length === 0) return ["Jobs: none registered"];

  // The record with the latest scheduled date for each job. Records of unregistered jobs are never read.
  const latest = new Map<string, RunRecord>();
  for (const run of runs) {
    const seen = latest.get(run.job);
    if (seen === undefined || run.scheduledDate > seen.scheduledDate) latest.set(run.job, run);
  }

  return jobs.map(({ name }) => {
    const run = latest.get(name);
    if (run === undefined) return `Job ${name}: not run yet`;
    const line = `Job ${name}: ${state(run, now)} · ${slot(run)}`;
    if (run.status !== "failed") return line;
    return `${line} · ${run.attempts} ${run.attempts === 1 ? "attempt" : "attempts"}`;
  });
}

/** The stored status, except a running attempt older than the lease, which shows as interrupted. */
function state(run: RunRecord, now: Date): string {
  if (run.status === "running" && run.startedAt !== null && now.getTime() - Date.parse(run.startedAt) > LEASE_MS) {
    return "interrupted";
  }
  return run.status;
}

/** `<Mon> <d> <HH>:00` from the stored household date and hour; no timezone conversion. */
function slot(run: RunRecord): string {
  const [, month, day] = run.scheduledDate.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day} ${String(run.scheduledHour).padStart(2, "0")}:00`;
}
