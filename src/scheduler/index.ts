import { Api } from "grammy";
import { ConfigError, readConfig, type Config } from "../gateway/config";
import { failureReason } from "../gateway/failure";
import type { FeatureModule, JobRegistration, Registry } from "../gateway/registry";
import { getAllowedChatId } from "../gateway/settings";
import { telegramClientOptions, waitOutShortRateLimits } from "../telegram/client";
import { catchUpMinutes, latestSlot, localTime, validateJobs, type Slot } from "./schedule";
import { sendOnce } from "./sends";
import { formatStatusLines, slotLabel, state } from "./status";
import {
  claimRun,
  failRun,
  findRuns,
  finishRun,
  latestRuns,
  LEASE_MS,
  recordSkipped,
  type TickRecord,
} from "./store";

export interface SchedulerOptions {
  /** The registry the gateway built; its jobs are validated at once (Decision 8). */
  registry: Registry;
  /** The clock for timestamps and the lease, not for slots (Decision 2). */
  now?: () => Date;
}

export interface Scheduler {
  /** The Worker's scheduled handler. It never throws (Decision 2). */
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>;
}

/**
 * What a tick does for one job (Decision 5). `alert` tells the group that a run's
 * window ended unfinished, or that a job that ran before was skipped.
 */
type Action = "run" | "skip" | "alert" | "none";

type StoredRun = TickRecord;

interface Planned {
  job: JobRegistration & { module: string };
  /** The one slot of this job for this tick; every reader takes its date from here (Decision 4). */
  slot: Slot;
  record: StoredRun | undefined;
  action: Action;
}

const NO_CHAT_ID = "No allowed chat id is stored";
/** The part name of a failure alert in the send records. */
const ALERT_PART = "failure_alert";

/** Validates the registered jobs and returns the tick (Decision 2). */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { registry } = options;
  validateJobs(registry.jobs);
  const now = options.now ?? (() => new Date());

  const scheduled = async (controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> => {
    try {
      await runTick(registry.jobs, controller, env, now);
    } catch {
      // A bug, not an expected failure. The next tick recovers from the stored records.
      log({ event: "tick_failed" });
    }
  };

  return { scheduled };
}

/** The seven steps of Decision 2. Expected failures are logged and end the tick or the job. */
async function runTick(
  jobs: Registry["jobs"],
  controller: ScheduledController,
  env: Env,
  now: () => Date,
): Promise<void> {
  // Step 1: no jobs, no work.
  if (jobs.length === 0) return;

  // Step 2: configuration fails closed, as in the gateway.
  let config: Config;
  try {
    config = readConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log({ event: "config_invalid", setting: error.setting });
    return;
  }

  // Step 3: slots come from the tick's scheduled time, not from the clock.
  const local = localTime(new Date(controller.scheduledTime), config.timezone);
  const slots = jobs.map((job) => ({ job, slot: latestSlot(job.schedule, local) }));

  // Step 4: one pre-read for every (job, slot date).
  const db = env.DB;
  let records: Awaited<ReturnType<typeof findRuns>>;
  try {
    records = await findRuns(
      db,
      slots.map(({ job, slot }) => ({ job: job.name, scheduledDate: slot.date })),
    );
  } catch {
    log({ event: "database_unavailable" });
    return;
  }

  // Step 5: one action per job.
  const planTime = now();
  const planned: Planned[] = slots.map(({ job, slot }) => {
    const record = records.get(`${job.name}\n${slot.date}`);
    return { job, slot, record, action: decide(job, slot, record, planTime) };
  });

  // Step 6: the chat id and the Telegram client, once, when anything runs or alerts.
  let chatId: number | null = null;
  let api: Api | null = null;
  if (planned.some(({ action }) => action === "run" || action === "alert")) {
    try {
      chatId = await getAllowedChatId(db);
    } catch {
      log({ event: "database_unavailable" });
      return;
    }
    api = new Api(config.botToken, telegramClientOptions());
    api.config.use(waitOutShortRateLimits());
  }

  // Step 7: act, one job after another, in registration order.
  for (const { job, slot, record, action } of planned) {
    const key = { job: job.name, scheduledDate: slot.date };
    const input = { ...key, scheduledHour: slot.hour };

    if (action === "alert") {
      if (api !== null && record !== undefined) await alert(db, api, chatId, input, record, now());
      continue;
    }

    if (action === "skip") {
      try {
        if (await recordSkipped(db, { ...input, now: now() })) {
          log({ event: "job_skipped", job: job.name, scheduled_date: slot.date });
        }
      } catch {
        log({ event: "database_unavailable", job: job.name });
      }
      continue;
    }
    if (action !== "run" || api === null) continue;

    let attempt: number | null;
    try {
      attempt = await claimRun(db, { ...input, now: now() });
    } catch {
      log({ event: "database_unavailable", job: job.name });
      continue;
    }
    // Another tick holds the claim.
    if (attempt === null) continue;

    let failure: { error: unknown } | null = null;
    if (chatId === null) {
      failure = { error: NO_CHAT_ID };
    } else {
      try {
        await job.run({
          env,
          db,
          now: now(),
          timezone: config.timezone,
          chatId,
          api,
          scheduledDate: slot.date,
        });
      } catch (error) {
        failure = { error };
      }
    }

    const outcome = { job: job.name, scheduled_date: slot.date, attempt };
    try {
      if (failure === null) {
        await finishRun(db, key, attempt, now());
        log({ event: "job_done", ...outcome });
      } else {
        await failRun(db, key, attempt, failure.error, now());
        log({ event: "job_failed", ...outcome, reason: failureReason(failure.error) });
      }
    } catch {
      log({ event: "run_not_recorded", ...outcome });
    }
  }
}

/**
 * Tells the group, once for the scheduled date and without a sound, that the run did
 * not finish in its window, or did not run at all. A failure is logged and tried
 * again on the next tick.
 */
async function alert(
  db: D1Database,
  api: Api,
  chatId: number | null,
  run: { job: string; scheduledDate: string; scheduledHour: number },
  record: StoredRun,
  now: Date,
): Promise<void> {
  const entry = { job: run.job, scheduled_date: run.scheduledDate };
  try {
    if (chatId === null) throw new Error(NO_CHAT_ID);
    const text = alertText(run, record, now);
    const outcome = await sendOnce(db, { job: run.job, scheduledDate: run.scheduledDate, part: ALERT_PART }, now, () =>
      api.sendMessage(chatId, text, { disable_notification: true, link_preview_options: { is_disabled: true } }),
    );
    if (outcome === "sent") log({ event: "job_alert_sent", ...entry });
  } catch {
    log({ event: "job_alert_failed", ...entry });
  }
}

/** The two lines of a failure alert. */
function alertText(run: { job: string; scheduledDate: string; scheduledHour: number }, record: StoredRun, now: Date): string {
  if (record.status === "skipped") {
    return (
      `⚠️ Job ${run.job} did not run · ${slotLabel(run)} · skipped\n` +
      "No tick came in its catch-up window, so it is not tried again for that date. /ping shows each job's last run."
    );
  }
  const attempts = `${record.attempts} ${record.attempts === 1 ? "attempt" : "attempts"}`;
  return (
    `⚠️ Job ${run.job} did not finish · ${slotLabel(run)} · ${state(record, now)}, ${attempts}\n` +
    "It is not tried again for that date. /ping shows each job's last run."
  );
}

/** The table of Decision 5. The pre-read only filters; the claim decides. */
function decide(job: JobRegistration, slot: Slot, record: StoredRun | undefined, now: Date): Action {
  if (slot.lateMinutes > catchUpMinutes(job)) {
    if (record === undefined) return "skip";
    return job.alertOnFailure === true && needsAlert(record, now) ? "alert" : "none";
  }
  if (record === undefined || record.status === "failed") return "run";
  if (record.status === "running" && record.startedAt !== null) {
    return now.getTime() - Date.parse(record.startedAt) > LEASE_MS ? "run" : "none";
  }
  return "none";
}

/**
 * A run that failed, or whose last attempt was cut off and is older than the lease,
 * or a skipped date of a job that ran before. The first skip of a new job, as after
 * the first deploy, is not worth an alert.
 */
function needsAlert(record: StoredRun, now: Date): boolean {
  if (record.status === "failed") return true;
  if (record.status === "skipped") return record.hasEarlierRun;
  return (
    record.status === "running" &&
    record.startedAt !== null &&
    now.getTime() - Date.parse(record.startedAt) > LEASE_MS
  );
}

/** One single-line JSON log entry, with no error message or job text (Decision 10); a failure gives only its reason code. */
function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

/** Adds each job's last run to `/ping` (Decision 9). */
export const scheduler: FeatureModule = {
  name: "scheduler",
  status: async (ctx) =>
    formatStatusLines(ctx.gateway.registry.jobs, await latestRuns(ctx.gateway.db), ctx.gateway.now),
};
