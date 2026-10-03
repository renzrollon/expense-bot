import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  buildRegistry,
  RegistrationError,
  type FeatureModule,
  type JobContext,
  type JobSchedule,
} from "../src/gateway/registry";
import { createScheduler, type Scheduler } from "../src/scheduler";
import { HOUSEHOLD_TZ } from "./helpers/constants";
import { failingDb, useCleanTables, type FailingDb } from "./helpers/db";
import { probeModule, type Probe } from "./helpers/probe";
import { insertRun, logEntries, readRun, tick } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";

useCleanTables(env.DB);

/** The allowed chat id stored in the settings, unless a scenario says otherwise. */
const CHAT_ID = -1001;
const T_21 = "2026-09-30T13:00:00Z";
const T_22 = "2026-09-30T14:00:00Z";
const DAY: JobSchedule = { every: "day", hour: 21 };

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
/** The scheduler's clock. `fire` sets it to the tick's scheduled time unless told otherwise. */
let clock = new Date(T_21);

beforeEach(async () => {
  telegram = installTelegramStub();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await storeChatId(CHAT_ID);
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

async function storeChatId(chatId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )
    .bind(String(chatId), "2026-09-01T00:00:00.000Z")
    .run();
}

/** A changed copy of the test environment. */
function envWith(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

/** A scheduler over the given modules, reading the shared `clock`. */
function build(...modules: FeatureModule[]): Scheduler {
  return createScheduler({
    registry: buildRegistry(modules),
    now: () => clock,
  });
}

/** One probe module with the named jobs, all daily at 21 unless given. */
function probeWith(
  names: string[],
  schedule: JobSchedule = DAY,
  moduleName = "probe",
): Probe {
  return probeModule({
    name: moduleName,
    jobs: names.map((name) => ({ name, schedule })),
  });
}

/** Fires one tick. The clock reads the tick's scheduled time, or `startedAt` when given. */
async function fire(
  scheduler: Scheduler,
  iso: string,
  options: { startedAt?: string; testEnv?: Env } = {},
): Promise<void> {
  clock = new Date(options.startedAt ?? iso);
  await tick(scheduler, iso, options.testEnv ?? env);
}

async function countRuns(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs").first<{
    n: number;
  }>();
  return row?.n ?? -1;
}

function contextsOf(probe: Probe, job: string): JobContext[] {
  return probe.callsTo(`job:${job}`).map((call) => call.args[0] as JobContext);
}

function dates(probe: Probe, job: string): string[] {
  return contextsOf(probe, job).map((context) => context.scheduledDate);
}

function events(name: string): Record<string, unknown>[] {
  return logEntries(logSpy).filter((entry) => entry["event"] === name);
}

/** An ISO time `minutes` before `iso`. */
function minutesBefore(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
}

describe("The system SHALL run the scheduler from one hourly trigger", () => {
  it("Failure — invalid settings", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await expect(
      fire(scheduler, T_21, {
        testEnv: envWith({ ALLOWED_USER_IDS: undefined }),
      }),
    ).resolves.toBeUndefined();

    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await countRuns()).toBe(0);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toBeNull();
    expect(events("config_invalid")).toEqual([
      { event: "config_invalid", setting: "ALLOWED_USER_IDS" },
    ]);
  });

  it("Edge case — no job registered", async () => {
    const db = failingDb(env.DB);
    db.failAll();
    const scheduler = build();

    await expect(
      fire(scheduler, T_21, { testEnv: envWith({ DB: db.db }) }),
    ).resolves.toBeUndefined();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("Edge case — the handler starts late", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21, { startedAt: "2026-09-30T13:04:00Z" });

    expect(dates(probe, "nightly")).toEqual(["2026-09-30"]);
    const run = await readRun(env.DB, "nightly", "2026-09-30");
    expect(run?.startedAt).toBe("2026-09-30T13:04:00.000Z");
  });
});

describe("The system SHALL validate job schedules at startup", () => {
  it("Happy path — valid schedules at their limits", () => {
    const probe = probeModule({
      name: "limits",
      jobs: [
        { name: "early", schedule: { every: "day", hour: 0 } },
        {
          name: "sunday_late",
          schedule: { every: "week", weekday: 7, hour: 23 },
        },
        { name: "month_end", schedule: { every: "month", day: 28, hour: 23 } },
        { name: "day_window", schedule: { every: "day", hour: 9 }, catchUpHours: 23 },
        { name: "week_window", schedule: { every: "week", weekday: 1, hour: 9 }, catchUpHours: 167 },
        { name: "month_window", schedule: { every: "month", day: 1, hour: 9 }, catchUpHours: 671 },
        { name: "one_hour", schedule: { every: "day", hour: 9 }, catchUpHours: 1 },
      ],
    });
    const registry = buildRegistry([probe.module]);

    expect(() => createScheduler({ registry })).not.toThrow();
    expect(registry.jobs.map((job) => job.name)).toEqual([
      "early",
      "sunday_late",
      "month_end",
      "day_window",
      "week_window",
      "month_window",
      "one_hour",
    ]);
  });

  it("Failure — hour out of range", () => {
    const probe = probeModule({
      name: "nudge",
      jobs: [{ name: "nudge", schedule: { every: "day", hour: 24 } }],
    });

    const create = () =>
      createScheduler({ registry: buildRegistry([probe.module]) });

    expect(create).toThrow(RegistrationError);
    expect(create).toThrow(/"nudge"[\s\S]*"nudge"[\s\S]*hour/);
  });

  it.each<{ label: string; name: string; schedule: unknown; field: string }>([
    {
      label: "monthly on day 29",
      name: "nudge",
      schedule: { every: "month", day: 29, hour: 8 },
      field: "day",
    },
    {
      label: "monthly on day 0",
      name: "nudge",
      schedule: { every: "month", day: 0, hour: 8 },
      field: "day",
    },
    {
      label: "weekly on weekday 0",
      name: "nudge",
      schedule: { every: "week", weekday: 0, hour: 8 },
      field: "weekday",
    },
    {
      label: "weekly on weekday 8",
      name: "nudge",
      schedule: { every: "week", weekday: 8, hour: 8 },
      field: "weekday",
    },
    {
      label: "daily at hour -1",
      name: "nudge",
      schedule: { every: "day", hour: -1 },
      field: "hour",
    },
    {
      label: "daily at hour 8.5",
      name: "nudge",
      schedule: { every: "day", hour: 8.5 },
      field: "hour",
    },
    {
      label: "daily with the name Nudge",
      name: "Nudge",
      schedule: { every: "day", hour: 8 },
      field: "name",
    },
  ])(
    "Edge case — values just outside each limit: $label",
    ({ name, schedule, field }) => {
      const probe = probeModule({
        name: "edge_module",
        jobs: [{ name, schedule: schedule as JobSchedule }],
      });

      let thrown: unknown;
      try {
        createScheduler({ registry: buildRegistry([probe.module]) });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RegistrationError);
      const message = (thrown as Error).message;
      expect(message).toContain(name);
      expect(message).toContain("edge_module");
      expect(message).toContain(field);
    },
  );

  it.each<{ label: string; schedule: JobSchedule; hours: unknown }>([
    { label: "a daily job with 24 hours", schedule: { every: "day", hour: 9 }, hours: 24 },
    { label: "a weekly job with 168 hours", schedule: { every: "week", weekday: 1, hour: 9 }, hours: 168 },
    { label: "a monthly job with 672 hours", schedule: { every: "month", day: 1, hour: 9 }, hours: 672 },
    { label: "0 hours", schedule: { every: "day", hour: 9 }, hours: 0 },
    { label: "1.5 hours", schedule: { every: "day", hour: 9 }, hours: 1.5 },
    { label: "hours as text", schedule: { every: "day", hour: 9 }, hours: "3" },
  ])("Failure — a catch-up window outside its limits: $label", ({ schedule, hours }) => {
    const probe = probeModule({
      name: "edge_module",
      jobs: [{ name: "late", schedule, catchUpHours: hours as number }],
    });

    const create = () => createScheduler({ registry: buildRegistry([probe.module]) });

    expect(create).toThrow(RegistrationError);
    expect(create).toThrow(/"late"[\s\S]*"edge_module"[\s\S]*catch-up window/);
  });
});

describe("The system SHALL run due jobs by household time", () => {
  it("Happy path — daily jobs at their hour", async () => {
    const probe = probeWith(["first", "second"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    expect(probe.calls.map((call) => call.handler)).toEqual([
      "job:first",
      "job:second",
    ]);
    expect(dates(probe, "first")).toEqual(["2026-09-30"]);
    expect(dates(probe, "second")).toEqual(["2026-09-30"]);
    for (const job of ["first", "second"]) {
      const run = await readRun(env.DB, job, "2026-09-30");
      expect(run).toMatchObject({ status: "done", attempts: 1 });
    }
  });

  it("Failure — not yet due", async () => {
    await insertRun(env.DB, {
      job: "nightly",
      scheduledDate: "2026-09-29",
      status: "done",
    });
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T12:00:00Z");

    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toBeNull();
  });

  it("Edge case — the household date differs from the UTC date", async () => {
    const probe = probeWith(["midnight"], { every: "day", hour: 0 });
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T16:00:00Z");

    expect(dates(probe, "midnight")).toEqual(["2026-10-01"]);
    expect(await readRun(env.DB, "midnight", "2026-10-01")).toMatchObject({
      status: "done",
      attempts: 1,
    });
    expect(await readRun(env.DB, "midnight", "2026-09-30")).toBeNull();
  });

  it("Edge case — weekly and monthly slots", async () => {
    const probe = probeModule({
      jobs: [
        { name: "digest", schedule: { every: "week", weekday: 7, hour: 19 } },
        { name: "recap", schedule: { every: "month", day: 1, hour: 8 } },
      ],
    });
    const scheduler = build(probe.module);

    // The ticks run in this order so that an earlier tick leaves no skipped record in the way of a later one.
    await fire(scheduler, "2026-10-01T00:00:00Z");
    expect(dates(probe, "recap")).toEqual(["2026-10-01"]);

    await fire(scheduler, "2026-10-04T11:00:00Z");
    expect(dates(probe, "digest")).toEqual(["2026-10-04"]);

    await fire(scheduler, "2026-12-31T23:00:00Z");
    expect(dates(probe, "recap")).toEqual(["2026-10-01"]);
    expect(dates(probe, "digest")).toEqual(["2026-10-04"]);
    expect(await readRun(env.DB, "recap", "2026-12-01")).toMatchObject({
      status: "skipped",
      attempts: 0,
    });
  });

  it("Edge case — a timezone with a half-hour offset", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);
    const kolkata = envWith({ HOUSEHOLD_TZ: "Asia/Kolkata" });

    await fire(scheduler, "2026-09-30T15:00:00Z", { testEnv: kolkata });
    expect(probe.callsTo("job:nightly")).toHaveLength(0);

    await fire(scheduler, "2026-09-30T16:00:00Z", { testEnv: kolkata });
    expect(dates(probe, "nightly")).toEqual(["2026-09-30"]);
    expect(contextsOf(probe, "nightly")[0]?.timezone).toBe("Asia/Kolkata");
  });
});

describe("The system SHALL run a job at most once per scheduled date", () => {
  it("Happy path — the same tick fires twice", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);
    await fire(scheduler, T_21);

    expect(probe.callsTo("job:nightly")).toHaveLength(1);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 1,
    });
  });

  it("Failure — another tick holds the claim", async () => {
    await insertRun(env.DB, {
      job: "nightly",
      status: "running",
      attempts: 1,
      createdAt: minutesBefore(T_22, 10),
      startedAt: minutesBefore(T_22, 10),
    });
    const before = await readRun(env.DB, "nightly", "2026-09-30");
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_22);

    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(before).not.toBeNull();
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toEqual(before);
  });

  it("Edge case — the claim's 30-minute boundary", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    const exactly = minutesBefore(T_22, 30);
    await insertRun(env.DB, {
      job: "nightly",
      status: "running",
      attempts: 1,
      createdAt: exactly,
      startedAt: exactly,
    });
    const before = await readRun(env.DB, "nightly", "2026-09-30");
    await fire(scheduler, T_22);
    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toEqual(before);

    await env.DB.prepare("DELETE FROM job_runs").run();
    const over = minutesBefore(T_22, 31);
    await insertRun(env.DB, {
      job: "nightly",
      status: "running",
      attempts: 1,
      createdAt: over,
      startedAt: over,
    });
    await fire(scheduler, T_22);
    expect(probe.callsTo("job:nightly")).toHaveLength(1);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 2,
    });
  });

  it("Edge case — a done job is not run again later in its window", async () => {
    await insertRun(env.DB, { job: "nightly", status: "done" });
    const before = await readRun(env.DB, "nightly", "2026-09-30");
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_22);

    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(before).not.toBeNull();
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toEqual(before);
  });
});

describe("The system SHALL give each job its own catch-up window", () => {
  it("Happy path — two jobs with their own windows", async () => {
    const probe = probeModule({
      jobs: [
        { name: "digest", schedule: { every: "week", weekday: 3, hour: 21 }, catchUpHours: 48 },
        { name: "nudge", schedule: DAY, catchUpHours: 1 },
      ],
    });
    const scheduler = build(probe.module);

    // Wednesday 2026-09-30 at 23:00: the nudge is 2 hours late, the digest too.
    await fire(scheduler, "2026-09-30T15:00:00Z");
    expect(probe.callsTo("job:nudge")).toHaveLength(0);
    expect(await readRun(env.DB, "nudge", "2026-09-30")).toMatchObject({ status: "skipped" });
    expect(dates(probe, "digest")).toEqual(["2026-09-30"]);
  });

  it("Edge case — the end of a 48-hour window", async () => {
    const at = (iso: string) => {
      const probe = probeModule({
        jobs: [{ name: "digest", schedule: { every: "week", weekday: 3, hour: 21 }, catchUpHours: 48 }],
      });
      return { probe, run: () => fire(build(probe.module), iso) };
    };

    // Friday 2026-10-02 at 21:00, exactly 48 hours after the slot.
    const onTime = at("2026-10-02T13:00:00Z");
    await onTime.run();
    expect(dates(onTime.probe, "digest")).toEqual(["2026-09-30"]);

    await env.DB.prepare("DELETE FROM job_runs").run();
    const late = at("2026-10-02T14:00:00Z");
    await late.run();
    expect(late.probe.callsTo("job:digest")).toHaveLength(0);
    expect(await readRun(env.DB, "digest", "2026-09-30")).toMatchObject({ status: "skipped" });
  });
});

describe("The system SHALL catch up missed jobs within their catch-up window and skip them after", () => {
  it("Happy path — a missed tick is caught up", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_22);

    expect(dates(probe, "nightly")).toEqual(["2026-09-30"]);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 1,
    });
  });

  it("Failure — later than the 3-hour window", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T17:00:00Z");
    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "skipped",
      attempts: 0,
    });

    await fire(scheduler, "2026-09-30T18:00:00Z");
    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await countRuns()).toBe(1);
  });

  it("Edge case — exactly 3 hours late", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T16:00:00Z");

    expect(dates(probe, "nightly")).toEqual(["2026-09-30"]);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 1,
    });
  });

  it("Edge case — a failed run stays failed after the window", async () => {
    await insertRun(env.DB, {
      job: "nightly",
      status: "failed",
      attempts: 3,
      lastError: "boom",
    });
    const before = await readRun(env.DB, "nightly", "2026-09-30");
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T17:00:00Z");

    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toEqual(before);
    expect(before).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "boom",
    });
    // The job did not ask for a failure alert, so the group is told nothing.
    expect(telegram.calls).toEqual([]);
  });
});

describe("The system SHALL isolate and retry failed jobs", () => {
  it("Happy path — a failed job is retried on the next tick", async () => {
    const probe = probeWith(["nightly"]);
    probe.failWith(new Error("network down"), "job:nightly");
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "network down",
    });

    probe.clearFailure();
    await fire(scheduler, T_22);
    expect(probe.callsTo("job:nightly")).toHaveLength(2);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 2,
    });
  });

  it("Failure — one job fails and the others still run", async () => {
    const probe = probeWith(["first", "second"]);
    probe.failWith(new Error("boom"), "job:first");
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    expect(probe.callsTo("job:second")).toHaveLength(1);
    expect(await readRun(env.DB, "second", "2026-09-30")).toMatchObject({
      status: "done",
    });
    expect(await readRun(env.DB, "first", "2026-09-30")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "boom",
    });
  });

  it("Edge case — a long error message", async () => {
    const message = "x".repeat(600);
    const probe = probeWith(["nightly"]);
    probe.failWith(new Error(message), "job:nightly");
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    const run = await readRun(env.DB, "nightly", "2026-09-30");
    expect(run?.status).toBe("failed");
    expect(run?.lastError).toBe(message.slice(0, 500));
  });
});

describe("The system SHALL give each run its context", () => {
  it("Happy path — a job sends to the group", async () => {
    const received: JobContext[] = [];
    const hello: FeatureModule = {
      name: "hello_module",
      jobs: [
        {
          name: "hello",
          schedule: DAY,
          run: async (context) => {
            received.push(context);
            await context.api.sendMessage(context.chatId, "hi");
          },
        },
      ],
    };
    const scheduler = build(hello);

    await fire(scheduler, T_21);

    const sent = telegram.callsTo("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({ chat_id: CHAT_ID, text: "hi" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      timezone: HOUSEHOLD_TZ,
      scheduledDate: "2026-09-30",
      chatId: CHAT_ID,
    });
  });

  it("Edge case — a short rate limit is waited out inside the run", async () => {
    const hello: FeatureModule = {
      name: "hello_module",
      jobs: [{ name: "hello", schedule: DAY, run: async (context) => void (await context.api.sendMessage(context.chatId, "hi")) }],
    };
    telegram.failNext("sendMessage", {
      error_code: 429,
      description: "Too Many Requests: retry after 0",
      parameters: { retry_after: 0 },
    });

    await fire(build(hello), T_21);

    expect(telegram.callsTo("sendMessage").map((call) => call.failed ?? false)).toEqual([true, false]);
    expect(await readRun(env.DB, "hello", "2026-09-30")).toMatchObject({ status: "done", attempts: 1 });
  });

  it("Failure — no allowed chat id is stored", async () => {
    await env.DB.prepare(
      "DELETE FROM settings WHERE key = 'allowed_chat_id'",
    ).run();
    const probe = probeWith(["hello"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    expect(probe.callsTo("job:hello")).toHaveLength(0);
    expect(telegram.calls).toHaveLength(0);
    expect(await readRun(env.DB, "hello", "2026-09-30")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "No allowed chat id is stored",
    });

    await storeChatId(CHAT_ID);
    await fire(scheduler, T_22);
    expect(contextsOf(probe, "hello").map((context) => context.chatId)).toEqual(
      [CHAT_ID],
    );
    expect(await readRun(env.DB, "hello", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 2,
    });
  });

  it("Edge case — a late run covers its scheduled date", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T16:00:00Z");

    const [context] = contextsOf(probe, "nightly");
    expect(context?.scheduledDate).toBe("2026-09-30");
    expect(context).toBeDefined();
    const householdDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: HOUSEHOLD_TZ,
    }).format(context?.now);
    expect(householdDate).toBe("2026-10-01");
  });
});

describe("The system SHALL keep ticking through database failures", () => {
  it("Happy path — the database recovers by the next tick", async () => {
    const db: FailingDb = failingDb(env.DB);
    const failing = envWith({ DB: db.db });
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    db.failAll();
    await fire(scheduler, T_21, { testEnv: failing });
    expect(probe.callsTo("job:nightly")).toHaveLength(0);
    expect(events("database_unavailable")).toHaveLength(1);

    db.heal();
    await fire(scheduler, T_22, { testEnv: failing });
    expect(probe.callsTo("job:nightly")).toHaveLength(1);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 1,
    });
  });

  it("Failure — one claim fails", async () => {
    const db = failingDb(env.DB);
    let failed = false;
    db.failWhen((sql) => {
      if (
        failed ||
        !sql.includes("ON CONFLICT (job, scheduled_date) DO UPDATE")
      )
        return false;
      failed = true;
      return true;
    });
    const probe = probeWith(["first", "second"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21, { testEnv: envWith({ DB: db.db }) });

    expect(probe.callsTo("job:first")).toHaveLength(0);
    expect(probe.callsTo("job:second")).toHaveLength(1);
    expect(await readRun(env.DB, "first", "2026-09-30")).toBeNull();
    expect(await readRun(env.DB, "second", "2026-09-30")).toMatchObject({
      status: "done",
    });
  });

  it("Edge case — the outcome cannot be saved", async () => {
    const db = failingDb(env.DB);
    const failing = envWith({ DB: db.db });
    db.failWhen((sql) => sql.includes("SET status = 'done'"));
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21, { testEnv: failing });

    expect(probe.callsTo("job:nightly")).toHaveLength(1);
    const unsaved = events("run_not_recorded");
    expect(unsaved).toHaveLength(1);
    expect(unsaved[0]).toMatchObject({ job: "nightly" });
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "running",
      attempts: 1,
    });

    db.heal();
    await fire(scheduler, T_22, { testEnv: failing });
    expect(probe.callsTo("job:nightly")).toHaveLength(2);
    expect(await readRun(env.DB, "nightly", "2026-09-30")).toMatchObject({
      status: "done",
      attempts: 2,
    });
  });
});

describe("The system SHALL log run outcomes without their content", () => {
  it("Happy path — a done run is logged", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    expect(events("job_done")).toEqual([
      {
        event: "job_done",
        job: "nightly",
        scheduled_date: "2026-09-30",
        attempt: 1,
      },
    ]);
  });

  it("Failure — a failed run is logged without its error", async () => {
    const probe = probeWith(["nightly"]);
    probe.failWith(new Error("lunch 250 by Ana"), "job:nightly");
    const scheduler = build(probe.module);

    await fire(scheduler, T_21);

    expect(events("job_failed")).toEqual([
      {
        event: "job_failed",
        job: "nightly",
        scheduled_date: "2026-09-30",
        attempt: 1,
        reason: "other",
      },
    ]);
    expect(
      logSpy.mock.calls.map((args) => String(args[0])).join("\n"),
    ).not.toContain("lunch 250 by Ana");
  });

  it("Failure — a refused Telegram call is logged with its code", async () => {
    const hello: FeatureModule = {
      name: "hello_module",
      jobs: [{ name: "hello", schedule: DAY, run: async (context) => void (await context.api.sendMessage(context.chatId, "hi")) }],
    };
    telegram.failNext("sendMessage", { error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" });

    await fire(build(hello), T_21);

    expect(events("job_failed")).toEqual([
      { event: "job_failed", job: "hello", scheduled_date: "2026-09-30", attempt: 1, reason: "telegram_403" },
    ]);
    expect(logSpy.mock.calls.map((args) => String(args[0])).join("\n")).not.toContain("kicked");
  });

  it("Edge case — a skip is logged once", async () => {
    const probe = probeWith(["nightly"]);
    const scheduler = build(probe.module);

    await fire(scheduler, "2026-09-30T17:00:00Z");
    await fire(scheduler, "2026-09-30T18:00:00Z");

    const skipped = events("job_skipped");
    expect(skipped).toEqual([
      { event: "job_skipped", job: "nightly", scheduled_date: "2026-09-30" },
    ]);
    expect(skipped[0]).not.toHaveProperty("attempt");
  });
});
