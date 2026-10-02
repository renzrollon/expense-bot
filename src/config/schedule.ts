import type { JobSchedule } from "../gateway/registry";

/**
 * Job schedules that are not settings (design Decision 2). Hours are household time.
 */

/** `weekly_digest`: Sunday at 19:00 (Decision 13). */
export const WEEKLY_DIGEST: JobSchedule = { every: "week", weekday: 7, hour: 19 };

/** `monthly_recap`: the 1st at 08:00 (Decision 13). */
export const MONTHLY_RECAP: JobSchedule = { every: "month", day: 1, hour: 8 };

/** `nightly_backup`: every day at 23:00 (Decision 16). */
export const NIGHTLY_BACKUP: JobSchedule = { every: "day", hour: 23 };

/** The hour of `evening_nudge` when `NUDGE_HOUR` is not set (Decision 14). */
export const DEFAULT_NUDGE_HOUR = 21;
