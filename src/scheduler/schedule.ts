import { RegistrationError, type JobSchedule, type Registry } from "../gateway/registry";

/** A run up to this many minutes after its slot still runs; later, it is skipped (Decision 5, D8). */
export const GRACE_MINUTES = 180;

/** A wall-clock reading in the household timezone (Decision 3). */
export interface LocalTime {
  /** YYYY-MM-DD. */
  date: string;
  /** 0 to 23. */
  hour: number;
  /** 0 to 59. */
  minute: number;
  /** 1 for Monday to 7 for Sunday. */
  weekday: number;
}

/** A job's latest slot for one tick. `date` is the run's scheduled date (Decision 4). */
export interface Slot {
  /** YYYY-MM-DD, household time. */
  date: string;
  /** The schedule's hour, 0 to 23. */
  hour: number;
  /** Minutes from the slot to the tick, on the local clock. */
  lateMinutes: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const JOB_NAME = /^[a-z0-9_]{1,32}$/;

/** Reads `instant` on the wall clock of `timezone` (Decision 3). */
export function localTime(instant: Date, timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const utc = Date.UTC(year, month - 1, day);
  return {
    date: formatDate(new Date(utc)),
    hour: part("hour"),
    minute: part("minute"),
    weekday: ((new Date(utc).getUTCDay() + 6) % 7) + 1,
  };
}

/** The most recent slot of `schedule` at or before `local` (Decision 3). */
export function latestSlot(schedule: JobSchedule, local: LocalTime): Slot {
  const [year, month, day] = local.date.split("-").map(Number) as [number, number, number];
  // The local wall clock, read as if it were UTC.
  const nowMs = Date.UTC(year, month - 1, day, local.hour, local.minute);
  const hour = schedule.hour;
  let candidate: number;
  switch (schedule.every) {
    case "day":
      candidate = Date.UTC(year, month - 1, day, hour);
      if (candidate > nowMs) candidate -= MS_PER_DAY;
      break;
    case "week":
      candidate = Date.UTC(year, month - 1, day - ((local.weekday - schedule.weekday + 7) % 7), hour);
      if (candidate > nowMs) candidate -= 7 * MS_PER_DAY;
      break;
    case "month":
      candidate = Date.UTC(year, month - 1, schedule.day, hour);
      // Date.UTC rolls month -1 back into December of the previous year.
      if (candidate > nowMs) candidate = Date.UTC(year, month - 2, schedule.day, hour);
      break;
  }
  return {
    date: formatDate(new Date(candidate)),
    hour,
    lateMinutes: (nowMs - candidate) / MS_PER_MINUTE,
  };
}

/** Throws RegistrationError for the first invalid job name or schedule (Decision 8). */
export function validateJobs(jobs: Registry["jobs"]): void {
  for (const job of jobs) {
    const { name, module } = job;
    if (typeof name !== "string" || !JOB_NAME.test(name)) {
      throw new RegistrationError(
        `Job name ${show(name)} in module "${module}" must be 1 to 32 of a-z, 0-9 and _`,
      );
    }
    const where = `Job "${name}" in module "${module}"`;
    const schedule = job.schedule as unknown;
    if (!isSchedule(schedule)) {
      throw new RegistrationError(`${where} has an unknown schedule kind`);
    }
    if (!isWhole(schedule.hour, 0, 23)) {
      throw new RegistrationError(
        `${where} has hour ${show(schedule.hour)}; the hour must be a whole number from 0 to 23`,
      );
    }
    if (schedule.every === "week" && !isWhole(schedule.weekday, 1, 7)) {
      throw new RegistrationError(
        `${where} has weekday ${show(schedule.weekday)}; the weekday must be a whole number from 1 (Monday) to 7 (Sunday)`,
      );
    }
    if (schedule.every === "month" && !isWhole(schedule.day, 1, 28)) {
      throw new RegistrationError(
        `${where} has day ${show(schedule.day)}; the day must be a whole number from 1 to 28`,
      );
    }
  }
}

/** An object whose `every` is one of the three schedule kinds; its other fields are not checked yet. */
function isSchedule(value: unknown): value is Record<string, unknown> & { every: JobSchedule["every"] } {
  if (typeof value !== "object" || value === null) return false;
  const every = (value as { every?: unknown }).every;
  return every === "day" || every === "week" || every === "month";
}

function isWhole(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** A number as written; any other value quoted, so the message shows what was registered. */
function show(value: unknown): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value) ?? String(value);
}

/** YYYY-MM-DD from the UTC fields of `date`. */
function formatDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
