import { describe, expect, it } from "vitest";
import { formatStatusLines } from "../../src/scheduler/status";
import type { RunRecord } from "../../src/scheduler/store";

const NOW = new Date("2026-09-30T15:00:00.000Z");

/** A start time `minutes` before NOW. */
function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/** A run record of `job`, `done` for 2026-09-30 at 21 unless overridden. */
function run(job: string, fields: Partial<RunRecord> = {}): RunRecord {
  return {
    job,
    scheduledDate: "2026-09-30",
    scheduledHour: 21,
    status: "done",
    attempts: 1,
    startedAt: "2026-09-30T13:00:00.000Z",
    lastError: null,
    ...fields,
  };
}

const jobs = (...names: string[]) => names.map((name) => ({ name }));

describe("formatStatusLines", () => {
  it.each<[string, { name: string }[], RunRecord[], string[]]>([
    ["no job registered", [], [run("old")], ["Jobs: none registered"]],
    ["a job not run yet", jobs("digest"), [], ["Job digest: not run yet"]],
    ["a done run", jobs("nightly"), [run("nightly")], ["Job nightly: done · Sep 30 21:00"]],
    [
      "a skipped run, with a single-digit day and hour",
      jobs("recap"),
      [run("recap", { scheduledDate: "2026-10-01", scheduledHour: 8, status: "skipped", attempts: 0, startedAt: null })],
      ["Job recap: skipped · Oct 1 08:00"],
    ],
    [
      "a running run started 10 minutes ago",
      jobs("nightly"),
      [run("nightly", { status: "running", startedAt: minutesBefore(10) })],
      ["Job nightly: running · Sep 30 21:00"],
    ],
    [
      "a running run started exactly 30 minutes ago",
      jobs("nightly"),
      [run("nightly", { status: "running", startedAt: minutesBefore(30) })],
      ["Job nightly: running · Sep 30 21:00"],
    ],
    [
      "a running run started 31 minutes ago",
      jobs("nightly"),
      [run("nightly", { status: "running", startedAt: minutesBefore(31) })],
      ["Job nightly: interrupted · Sep 30 21:00"],
    ],
    [
      "a failed run with 1 attempt",
      jobs("nightly"),
      [run("nightly", { status: "failed", attempts: 1 })],
      ["Job nightly: failed · Sep 30 21:00 · 1 attempt"],
    ],
    [
      "a failed run with 2 attempts",
      jobs("nightly"),
      [run("nightly", { status: "failed", attempts: 2 })],
      ["Job nightly: failed · Sep 30 21:00 · 2 attempts"],
    ],
    [
      "a failed run with its reason",
      jobs("nightly"),
      [run("nightly", { status: "failed", attempts: 3, lastError: "BACKUP_CHAT_ID is not a chat id" })],
      ["Job nightly: failed · Sep 30 21:00 · 3 attempts · BACKUP_CHAT_ID is not a chat id"],
    ],
    [
      "a failed run with a long reason on two lines",
      jobs("nightly"),
      [
        run("nightly", {
          status: "failed",
          attempts: 1,
          lastError: "Call to 'sendDocument' failed!   (400: Bad Request: chat not found)\nat stack",
        }),
      ],
      ["Job nightly: failed · Sep 30 21:00 · 1 attempt · Call to 'sendDocument' failed! (400: Bad Request: chat not…"],
    ],
    [
      "a running run keeps an earlier attempt's reason to itself",
      jobs("nightly"),
      [run("nightly", { status: "running", startedAt: minutesBefore(10), lastError: "boom" })],
      ["Job nightly: running · Sep 30 21:00"],
    ],
    [
      "a record of an unregistered job",
      jobs("nightly"),
      [run("old", { scheduledDate: "2026-10-01" }), run("nightly")],
      ["Job nightly: done · Sep 30 21:00"],
    ],
    [
      "jobs in registration order, not in record order",
      jobs("zeta", "alpha", "mid"),
      [run("alpha"), run("mid", { status: "skipped", attempts: 0, startedAt: null }), run("zeta", { scheduledHour: 7 })],
      ["Job zeta: done · Sep 30 07:00", "Job alpha: done · Sep 30 21:00", "Job mid: skipped · Sep 30 21:00"],
    ],
    [
      "a record in December",
      jobs("recap"),
      [run("recap", { scheduledDate: "2026-12-01", scheduledHour: 8 })],
      ["Job recap: done · Dec 1 08:00"],
    ],
  ])("%s", (_label, registered, runs, expected) => {
    expect(formatStatusLines(registered, runs, NOW)).toEqual(expected);
  });
});
