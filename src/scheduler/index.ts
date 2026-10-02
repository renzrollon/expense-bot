import { Api } from "grammy";
import { ConfigError, readConfig, type Config } from "../gateway/config";
import type { FeatureModule, JobRegistration, Registry } from "../gateway/registry";
import { getAllowedChatId } from "../gateway/settings";
import { GRACE_MINUTES, latestSlot, localTime, validateJobs, type Slot } from "./schedule";
import { formatStatusLines } from "./status";
import {
  claimRun,
  failRun,
  findRuns,
  finishRun,
  latestRuns,
  LEASE_MS,
  recordSkipped,
  type RunRecord,
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

/** What a tick does for one job (Decision 5). */
type Action = "run" | "skip" | "none";

interface Planned {
  job: JobRegistration & { module: string };
  /** The one slot of this job for this tick; every reader takes its date from here (Decision 4). */
  slot: Slot;
  action: Action;
}

const NO_CHAT_ID = "No allowed chat id is stored";

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
  const planned: Planned[] = slots.map(({ job, slot }) => ({
    job,
    slot,
    action: decide(slot, records.get(`${job.name}\n${slot.date}`), planTime),
  }));

  // Step 6: the chat id and the Telegram client, once, when anything runs.
  let chatId: number | null = null;
  let api: Api | null = null;
  if (planned.some(({ action }) => action === "run")) {
    try {
      chatId = await getAllowedChatId(db);
    } catch {
      log({ event: "database_unavailable" });
      return;
    }
    api = new Api(config.botToken, {
      // Look up the global fetch at call time, so tests can replace it.
      fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch,
    });
  }

  // Step 7: act, one job after another, in registration order.
  for (const { job, slot, action } of planned) {
    const key = { job: job.name, scheduledDate: slot.date };
    const input = { ...key, scheduledHour: slot.hour };

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
        log({ event: "job_failed", ...outcome });
      }
    } catch {
      log({ event: "run_not_recorded", ...outcome });
    }
  }
}

/** The table of Decision 5. The pre-read only filters; the claim decides. */
function decide(slot: Slot, record: Omit<RunRecord, "scheduledHour"> | undefined, now: Date): Action {
  if (slot.lateMinutes > GRACE_MINUTES) return record === undefined ? "skip" : "none";
  if (record === undefined || record.status === "failed") return "run";
  if (record.status === "running" && record.startedAt !== null) {
    return now.getTime() - Date.parse(record.startedAt) > LEASE_MS ? "run" : "none";
  }
  return "none";
}

/** One single-line JSON log entry, with no error message or job text (Decision 10). */
function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

/** Adds each job's last run to `/ping` (Decision 9). */
export const scheduler: FeatureModule = {
  name: "scheduler",
  status: async (ctx) =>
    formatStatusLines(ctx.gateway.registry.jobs, await latestRuns(ctx.gateway.db), ctx.gateway.now),
};
