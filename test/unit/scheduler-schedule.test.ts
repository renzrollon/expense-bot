import { describe, expect, it } from "vitest";
import { RegistrationError, type JobSchedule, type Registry } from "../../src/gateway/registry";
import { latestSlot, localTime, validateJobs, type LocalTime, type Slot } from "../../src/scheduler/schedule";

/** A local wall-clock reading. The weekday is written out, 1 for Monday to 7 for Sunday. */
function local(date: string, hour: number, minute: number, weekday: number): LocalTime {
  return { date, hour, minute, weekday };
}

describe("localTime", () => {
  it.each<[string, string, string, LocalTime]>([
    ["Manila, 21:00 on Wednesday 30 September", "Asia/Manila", "2026-09-30T13:00:00Z", local("2026-09-30", 21, 0, 3)],
    ["Manila, one minute before midnight", "Asia/Manila", "2026-09-30T15:59:00Z", local("2026-09-30", 23, 59, 3)],
    ["Manila, midnight is 00, on Thursday 1 October", "Asia/Manila", "2026-09-30T16:00:00Z", local("2026-10-01", 0, 0, 4)],
    ["Kolkata, a half-hour offset", "Asia/Kolkata", "2026-09-30T15:00:00Z", local("2026-09-30", 20, 30, 3)],
    ["New York, before the spring gap", "America/New_York", "2026-03-08T06:00:00Z", local("2026-03-08", 1, 0, 7)],
    ["New York, after the spring gap", "America/New_York", "2026-03-08T07:00:00Z", local("2026-03-08", 3, 0, 7)],
    ["New York, the first 01:00 of the autumn overlap", "America/New_York", "2026-11-01T05:00:00Z", local("2026-11-01", 1, 0, 7)],
    ["New York, the second 01:00 of the autumn overlap", "America/New_York", "2026-11-01T06:00:00Z", local("2026-11-01", 1, 0, 7)],
    ["New York, after the autumn overlap", "America/New_York", "2026-11-01T07:00:00Z", local("2026-11-01", 2, 0, 7)],
  ])("%s", (_label, timezone, instant, expected) => {
    expect(localTime(new Date(instant), timezone)).toEqual(expected);
  });
});

describe("latestSlot", () => {
  const day = (hour: number): JobSchedule => ({ every: "day", hour });
  const week = (weekday: number, hour: number): JobSchedule => ({ every: "week", weekday, hour });
  const month = (dayOfMonth: number, hour: number): JobSchedule => ({ every: "month", day: dayOfMonth, hour });

  it.each<[string, LocalTime, JobSchedule, Slot]>([
    // The examples of design Decision 3.
    ["day 21 at 21:00, on time", local("2026-09-30", 21, 0, 3), day(21), { date: "2026-09-30", hour: 21, lateMinutes: 0 }],
    ["day 21 at 00:00, 3 hours late", local("2026-10-01", 0, 0, 4), day(21), { date: "2026-09-30", hour: 21, lateMinutes: 180 }],
    ["day 21 at 01:00, 4 hours late", local("2026-10-01", 1, 0, 4), day(21), { date: "2026-09-30", hour: 21, lateMinutes: 240 }],
    ["day 21 at 20:00, the day before", local("2026-09-30", 20, 0, 3), day(21), { date: "2026-09-29", hour: 21, lateMinutes: 1380 }],
    ["day 0 at 00:00, on time", local("2026-10-01", 0, 0, 4), day(0), { date: "2026-10-01", hour: 0, lateMinutes: 0 }],
    ["week 7 at 19 on Sunday 19:00", local("2026-10-04", 19, 0, 7), week(7, 19), { date: "2026-10-04", hour: 19, lateMinutes: 0 }],
    ["week 7 at 19 on Sunday 18:00", local("2026-10-04", 18, 0, 7), week(7, 19), { date: "2026-09-27", hour: 19, lateMinutes: 10020 }],
    ["month 1 at 8 on 1 October 08:00", local("2026-10-01", 8, 0, 4), month(1, 8), { date: "2026-10-01", hour: 8, lateMinutes: 0 }],
    ["month 1 at 8 on 1 January 07:00", local("2027-01-01", 7, 0, 5), month(1, 8), { date: "2026-12-01", hour: 8, lateMinutes: 44580 }],
    // Half-hour local times, as in Asia/Kolkata.
    ["day 21 at 20:30", local("2026-09-30", 20, 30, 3), day(21), { date: "2026-09-29", hour: 21, lateMinutes: 1410 }],
    ["day 21 at 21:30", local("2026-09-30", 21, 30, 3), day(21), { date: "2026-09-30", hour: 21, lateMinutes: 30 }],
    // A daily slot across the year boundary.
    ["day 21 at 00:00 on 1 January", local("2027-01-01", 0, 0, 5), day(21), { date: "2026-12-31", hour: 21, lateMinutes: 180 }],
    // Weekly slots at every weekday offset, from Wednesday 30 September at 21:00.
    ["week offset 0", local("2026-09-30", 21, 0, 3), week(3, 21), { date: "2026-09-30", hour: 21, lateMinutes: 0 }],
    ["week offset 1", local("2026-09-30", 21, 0, 3), week(2, 21), { date: "2026-09-29", hour: 21, lateMinutes: 1440 }],
    ["week offset 2", local("2026-09-30", 21, 0, 3), week(1, 21), { date: "2026-09-28", hour: 21, lateMinutes: 2880 }],
    ["week offset 3", local("2026-09-30", 21, 0, 3), week(7, 21), { date: "2026-09-27", hour: 21, lateMinutes: 4320 }],
    ["week offset 4", local("2026-09-30", 21, 0, 3), week(6, 21), { date: "2026-09-26", hour: 21, lateMinutes: 5760 }],
    ["week offset 5", local("2026-09-30", 21, 0, 3), week(5, 21), { date: "2026-09-25", hour: 21, lateMinutes: 7200 }],
    ["week offset 6", local("2026-09-30", 21, 0, 3), week(4, 21), { date: "2026-09-24", hour: 21, lateMinutes: 8640 }],
    // A monthly candidate that falls in the previous year.
    ["month 10 at 9 on 5 January", local("2027-01-05", 10, 0, 2), month(10, 9), { date: "2026-12-10", hour: 9, lateMinutes: 37500 }],
  ])("%s", (_label, now, schedule, expected) => {
    expect(latestSlot(schedule, now)).toEqual(expected);
  });
});

describe("validateJobs", () => {
  type Job = Registry["jobs"][number];

  function job(name: string, module: string, schedule: unknown): Job {
    return { name, module, schedule: schedule as JobSchedule, run: async () => {} };
  }

  /** Returns the RegistrationError that validateJobs throws, and rethrows any other error. */
  function registrationError(jobs: Job[]): RegistrationError {
    try {
      validateJobs(jobs);
    } catch (error) {
      if (error instanceof RegistrationError) return error;
      throw error;
    }
    throw new Error("validateJobs did not throw");
  }

  it.each<[string, Job, string[]]>([
    ["name with an uppercase letter", job("Nudge", "nudge", { every: "day", hour: 9 }), ['"Nudge"', '"nudge"', "name"]],
    ["name of 33 characters", job("a".repeat(33), "long", { every: "day", hour: 9 }), [`"${"a".repeat(33)}"`, '"long"', "name"]],
    ["empty name", job("", "blank", { every: "day", hour: 9 }), ['""', '"blank"', "name"]],
    ["name with a hyphen", job("night-ly", "nightly", { every: "day", hour: 9 }), ['"night-ly"', '"nightly"', "name"]],
    ["unknown schedule kind", job("x", "m", { every: "year", hour: 9 }), ['"x"', '"m"', "schedule kind"]],
    ["hour 24", job("nudge", "nudge", { every: "day", hour: 24 }), ['"nudge"', 'module "nudge"', "hour 24"]],
    ["hour -1", job("nightly", "ledger", { every: "day", hour: -1 }), ['"nightly"', '"ledger"', "hour -1"]],
    ["hour 8.5", job("nightly", "ledger", { every: "day", hour: 8.5 }), ['"nightly"', '"ledger"', "hour 8.5"]],
    ["weekday 0", job("digest", "report", { every: "week", weekday: 0, hour: 19 }), ['"digest"', '"report"', "weekday 0"]],
    ["weekday 8", job("digest", "report", { every: "week", weekday: 8, hour: 19 }), ['"digest"', '"report"', "weekday 8"]],
    ["day 29", job("recap", "report", { every: "month", day: 29, hour: 8 }), ['"recap"', '"report"', "day 29"]],
    ["day 0", job("recap", "report", { every: "month", day: 0, hour: 8 }), ['"recap"', '"report"', "day 0"]],
  ])("refuses a job with %s", (_label, invalid, named) => {
    const error = registrationError([invalid]);
    expect(error).toBeInstanceOf(RegistrationError);
    expect(error.name).toBe("RegistrationError");
    for (const value of named) expect(error.message).toContain(value);
  });

  it("names the module of the invalid job when an earlier job is valid", () => {
    const error = registrationError([
      job("nightly", "ledger", { every: "day", hour: 21 }),
      job("nudge", "nudge", { every: "day", hour: 24 }),
    ]);
    expect(error.message).toBe(
      'Job "nudge" in module "nudge" has hour 24; the hour must be a whole number from 0 to 23',
    );
  });

  it.each<[string, unknown]>([
    ["hour 0", { every: "day", hour: 0 }],
    ["hour 23", { every: "day", hour: 23 }],
    ["weekday 1", { every: "week", weekday: 1, hour: 9 }],
    ["weekday 7", { every: "week", weekday: 7, hour: 9 }],
    ["day 1", { every: "month", day: 1, hour: 9 }],
    ["day 28", { every: "month", day: 28, hour: 9 }],
  ])("accepts %s", (_label, schedule) => {
    expect(validateJobs([job("valid_job_1", "limits", schedule)])).toBeUndefined();
  });

  it("accepts a name of 32 characters and no jobs at all", () => {
    expect(validateJobs([job("a".repeat(32), "limits", { every: "day", hour: 9 })])).toBeUndefined();
    expect(validateJobs([])).toBeUndefined();
  });
});
