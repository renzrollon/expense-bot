## Context

See proposal.md for the motivation. This change adds EB-09 on top of the archived gateway (`bot-gateway`). The gateway already defines the job contract but never runs a job:

- `FeatureModule.jobs` holds `JobRegistration { name, schedule, run }`. `JobSchedule` has three kinds: `{ every: "day", hour }`, `{ every: "week", weekday, hour }` with 1 for Monday and 7 for Sunday, and `{ every: "month", day, hour }` (src/gateway/registry.ts:26-35). `buildRegistry` checks only that job names are unique, and leaves schedule values to EB-09 (openspec/changes/archive/2026-09-29-add-bot-gateway/design.md:510).
- `JobContext { env, db, now, timezone, chatId, api }` is defined, and nothing builds one yet (registry.ts:37-44; archived gateway decision D42).
- A module may register a `status` function. `/ping` adds its lines after its own four lines. If the function throws, `/ping` shows `<module>: status unavailable` (src/core/index.ts:38-46).
- The Worker entry exports `{ fetch }`. The gateway design reserved `src/index.ts` for the `scheduled` handler that EB-09 adds (archived gateway design.md:130; decision D33).

Constraints that shape the design:

- **Cron runs in UTC, and the free plan allows 5 triggers per account** (docs/epic.md:154, 533).
- **Limits for a cron invocation.** CPU time is capped at 10 ms and wall time at 15 minutes (Cloudflare Workers limits page, fetched 2026-09-30). An invocation may run 50 D1 statements (docs/epic.md:155).
- **D1 has no interactive transactions.** One statement is atomic (archived gateway design.md:20).
- **Schema conventions from 0001.** Tables are `STRICT`, timestamps are ISO-8601 UTC text, text enums are constrained with `CHECK`, and there are no triggers or foreign keys (migrations/0001_bot_gateway.sql:1-30).
- **Store style.** A store is a plain function over `D1Database` that takes `now` as an argument. It makes a write idempotent with `INSERT ... ON CONFLICT ... RETURNING` instead of catching an error (src/gateway/update-log.ts:44-83).

No explore brief exists for this change. Discovery was done while the artifacts were written. `decisions.md` records every decision below with its evidence.

## Goals / Non-Goals

**Goals:**
- The tick is a short pipeline that tests can drive through the runtime's `scheduled` handler, with a fixed tick time and a fixed clock.
- Finding the latest slot is a pure function over a local wall-clock time. A table of cases tests it, covering midnight, weekdays, month and year boundaries, a half-hour offset and daylight saving time.
- One atomic statement decides whether a run is claimed. A duplicate or overlapping tick can never run a job twice while the first attempt is alive.
- The scheduled date is computed once per job per tick. Every reader uses that one value.

**Non-Goals:**
- Any change to gateway behavior. The only gateway file touched is `registry.ts`, where `JobContext` gains one field (D20).
- Parallel jobs within a tick, priorities, or dependencies between jobs.
- Any retry after the 3-hour window, and a cap on attempts inside it (D13).

## Decisions

### Decision 1: Layout and wiring (D2, D3, D29)

```
src/scheduler/schedule.ts   localTime, latestSlot, validateJobs, GRACE_MINUTES (pure)
src/scheduler/store.ts      job_runs store: findRuns, claimRun, finishRun, failRun,
                            recordSkipped, latestRuns, LEASE_MS
src/scheduler/status.ts     formatStatusLines (pure)
src/scheduler/index.ts      createScheduler (the tick) and the `scheduler` module (/ping lines)
migrations/0004_job_scheduler.sql
```

`src/index.ts` becomes:

```ts
const gateway = createGateway({ modules });
const scheduler = createScheduler({ registry: gateway.registry });

export default {
  fetch: gateway.fetch,
  scheduled: scheduler.scheduled,
} satisfies ExportedHandler<Env>;
```

The gateway design expected one added line. This design adds two, because the scheduler needs the registry that `createGateway` builds. Building the registry a second time would repeat the validation and could diverge from the gateway's copy.

`src/modules.ts` gains `scheduler` after `core`. The module registers only a `status` function. `wrangler.jsonc` gains `"triggers": { "crons": ["0 * * * *"] }`.

*Alternative considered:* let `createGateway` return `scheduled` as well. That rewrites the gateway entry point and its spec for a concern the epic assigns to its own capability.

### Decision 2: The tick (D4, D17, D18, D26)

`scheduler.scheduled(controller, env, ctx)` does these steps, in order. It never throws.

1. **No jobs, no work.** When `registry.jobs` is empty, return. This reads no setting and runs no statement.
2. **Configuration.** Call `readConfig(env)`. On a `ConfigError`, log `config_invalid` with the setting name and return. The scheduler uses the same settings as the gateway and fails closed in the same way (docs/setup.md:100).
3. **Tick time.** `tick = new Date(controller.scheduledTime)`. Compute `local = localTime(tick, config.timezone)`, then `slot = latestSlot(job.schedule, local)` for each job. The scheduler's clock, `options.now ?? (() => new Date())`, is used only for timestamps and the lease. `createGateway` takes a clock in the same way (src/gateway/index.ts:14, 33).
4. **Pre-read.** One `findRuns` statement reads the run records for every `(job, slot.date)` pair. On an error, log `database_unavailable` and return.
5. **Plan.** Decide one action per job with the table in Decision 5: `run`, `skip` or `none`.
6. **Chat id and client.** When at least one action is `run`, read the allowed chat id once with `getAllowedChatId(db)`. On an error, log `database_unavailable` and return. Then build one grammY `Api` (Decision 7).
7. **Act.** Go through the jobs one after another, in registration order:
   - `skip` → `recordSkipped`. When it returns `true`, log `job_skipped`. On an error, log `database_unavailable` with the job and go on.
   - `run` → `claimRun`. On an error, log `database_unavailable` with the job and go on. When it returns `null`, another tick holds the claim, so go on. Otherwise:
     - When the chat id is `null`, do not call the job. Call `failRun` with `No allowed chat id is stored`.
     - Otherwise `await job.run(context)`. On success call `finishRun`. On a throw call `failRun` with the error message.
     - After `finishRun` or `failRun` succeeds, log `job_done` or `job_failed`. When either store call fails, log `run_not_recorded` and go on.

The whole body sits in one outer `try`. An unexpected error, which would be a bug, is logged as `tick_failed` and swallowed. Cloudflare does not retry a failed cron invocation, and the next tick recovers from the stored records either way.

*Alternative considered:* read the chat id per job. That costs one statement per run for a value that almost never changes within one tick.

### Decision 3: Local time and the latest slot (D5, D6, D16, D30)

`localTime(instant, timezone)` calls `Intl.DateTimeFormat("en-US", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant)`. It returns `{ date: "YYYY-MM-DD", hour, minute, weekday }`. The weekday is computed from the date as `((Date.UTC(y, m - 1, d).getUTCDay() + 6) % 7) + 1`, so 1 is Monday and 7 is Sunday. It is not parsed from a locale string. `hourCycle: "h23"` keeps midnight as `00`, not `24`. The parser has a similar private reading (src/parser/dates.ts:7-19). The scheduler does not import the parser, because it also needs the hour and the minute, and the two modules share nothing else.

`latestSlot(schedule, local)` works on the **local wall clock as if it were UTC**: `nowMs = Date.UTC(y, m - 1, d, hour, minute)`. With `H` for the schedule's hour:

| Kind | First candidate | When the candidate is later than `nowMs` |
|---|---|---|
| day | `Date.UTC(y, m-1, d, H)` | subtract 1 day |
| week | `Date.UTC(y, m-1, d - ((weekday - W + 7) % 7), H)` | subtract 7 days |
| month | `Date.UTC(y, m-1, D, H)` | `Date.UTC(y, m-2, D, H)`. `Date.UTC` rolls month -1 back into the previous year |

The result is `{ date, hour: H, lateMinutes: (nowMs - candidate) / 60000 }`, where `date` is read from the candidate's UTC fields. The day of the month is at most 28 (Decision 8), so every month has the candidate day and no clamping rule is needed.

**Daylight saving time.** The household timezone, `Asia/Manila`, has none. For other zones, lateness is measured on the local clock:
- In the spring gap, a 02:00 slot that does not exist is reached by the 03:00 tick, 60 minutes late, and runs.
- In the autumn overlap, 01:00 happens twice. The second 01:00 tick finds the record `done` for that date, so the job does not run again.

A lateness measured on the local clock can be off by one hour from real elapsed time on those two nights. That is accepted.

*Alternative considered:* convert each slot to a UTC instant. That needs an offset search per timezone to handle the gap and the overlap, and it gives no better behavior for a 3-hour window.

**Examples.** The unit test table in Decision 11 holds these cases and more.

| Household time | Schedule | Slot date | Late (min) |
|---|---|---|---|
| 2026-09-30 21:00 | day 21 | 2026-09-30 | 0 |
| 2026-10-01 00:00 | day 21 | 2026-09-30 | 180 |
| 2026-10-01 01:00 | day 21 | 2026-09-30 | 240 |
| 2026-09-30 20:00 | day 21 | 2026-09-29 | 1380 |
| 2026-10-01 00:00 | day 0 | 2026-10-01 | 0 |
| 2026-10-04 19:00 (Sun) | week 7, 19 | 2026-10-04 | 0 |
| 2026-10-04 18:00 (Sun) | week 7, 19 | 2026-09-27 | 10020 |
| 2026-10-01 08:00 | month 1, 8 | 2026-10-01 | 0 |
| 2027-01-01 07:00 | month 1, 8 | 2026-12-01 | 44580 |

### Decision 4: The scheduled date is the one period key (D7, D20)

A change like this can go wrong when two readers compute the same period differently. For example, the scheduler could key its record by the slot date while a job computes "today" from its current time. So `latestSlot` computes the scheduled date **once per job per tick**, and every reader takes it from that one `Slot` value:

| Reader | Uses |
|---|---|
| `findRuns`, `claimRun`, `finishRun`, `failRun`, `recordSkipped` | `job_runs.scheduled_date`, part of the primary key |
| `/ping` lines | `scheduled_date` and `scheduled_hour` from the stored record, rendered as-is |
| The job | `JobContext.scheduledDate` |
| Log entries | `scheduled_date` |

No reader derives the date again from `tick`, `now` or UTC. The doc comment on `JobContext.scheduledDate` states the rule for later jobs: EB-10 derives its week and month, EB-11 its day, and EB-12 its months from `scheduledDate`, not from `now`. A run that is 3 hours late, at 00:00, then still covers the right day. The spec scenario "Edge case — a late run covers its scheduled date" tests this.

Job names are the other half of the key. `validateJobs` limits them to lowercase letters, digits and underscores, so two spellings of one name cannot both exist. A renamed job starts with no records. `/ping` hides the old name's records because it lists registered jobs only.

### Decision 5: What a tick does for each job (D8, D9, D10, D11, D13)

Here `late` is `slot.lateMinutes`, `GRACE_MINUTES = 180` and `LEASE_MS = 1_800_000`, which is 30 minutes.

| `late` | Stored record for `(job, slot.date)` | Action |
|---|---|---|
| ≤ 180 | none | run |
| ≤ 180 | `failed` | run (retry) |
| ≤ 180 | `running`, started more than 30 minutes before `now()` | run (reclaim) |
| ≤ 180 | `running`, started 30 minutes or less before `now()` | none |
| ≤ 180 | `done` or `skipped` | none |
| > 180 | none | skip |
| > 180 | any record | none |

The pre-read only filters. The claim statement decides. A tick that sees `failed`, and loses the claim to a concurrent tick, gets `null` back and does nothing.

**The window is inclusive (D8).** The epic says "later than the grace window" is skipped. So a run exactly 180 minutes late still runs: the 00:00 tick runs a 21:00 job. With hourly ticks a job gets up to 4 tries: on time, then +1, +2 and +3 hours.

**Why the lease is 30 minutes (D11).** It must be longer than any live attempt, and a cron invocation's wall time is capped at 15 minutes. It must also be shorter than the 60 minutes between ticks, so that the next tick recovers a killed attempt. 30 minutes meets both. The boundary matches the gateway: exactly 30 minutes is still held, as with the gateway's lease (openspec/specs/bot-gateway/spec.md:255-257).

**No cap on attempts (D13).** The window already bounds the tries to 4.

**A failed run stays failed after the window (D9).** The epic's "recorded as skipped" covers a missed slot. A run that was tried and failed keeps the more useful status.

### Decision 6: The `job_runs` table and its statements (D10, D12, D21, D22, D23)

```sql
CREATE TABLE job_runs (
  job            TEXT    NOT NULL CHECK (length(job) BETWEEN 1 AND 32),
  scheduled_date TEXT    NOT NULL CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  scheduled_hour INTEGER NOT NULL CHECK (scheduled_hour BETWEEN 0 AND 23),
  status         TEXT    NOT NULL CHECK (status IN ('running', 'done', 'failed', 'skipped')),
  attempts       INTEGER NOT NULL CHECK (attempts >= 0),
  last_error     TEXT,
  created_at     TEXT    NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
  PRIMARY KEY (job, scheduled_date),
  CHECK ((status = 'skipped') = (attempts = 0)),
  CHECK (status = 'skipped' OR started_at IS NOT NULL)
) STRICT;
```

The composite primary key is the "one row per job per period" rule from the epic. Its index serves both the pre-read and the latest-per-job query. `scheduled_hour` is stored because a job's hour can change between deploys, and `/ping` shows the slot of the record, not the current schedule.

The statements, with `key = (job, scheduled_date)`:

- **`findRuns(db, keys)`** reads every requested key in one statement: `SELECT job, scheduled_date, status, attempts, started_at FROM job_runs WHERE (job, scheduled_date) IN (VALUES (?1, ?2), (?3, ?4), ...)`. With no keys it returns an empty list and runs no statement. It returns a `Map` keyed by `` `${job}\n${date}` ``.
- **`claimRun(db, { job, scheduledDate, scheduledHour, now })`** returns the attempt number, or `null`:
  ```sql
  INSERT INTO job_runs (job, scheduled_date, scheduled_hour, status, attempts, created_at, started_at)
  VALUES (?1, ?2, ?3, 'running', 1, ?4, ?4)
  ON CONFLICT (job, scheduled_date) DO UPDATE SET
    status = 'running', attempts = job_runs.attempts + 1,
    scheduled_hour = excluded.scheduled_hour, started_at = excluded.started_at, finished_at = NULL
  WHERE job_runs.status = 'failed'
     OR (job_runs.status = 'running' AND job_runs.started_at < ?5)
  RETURNING attempts
  ```
  `?5` is `now - LEASE_MS` as ISO text. This mirrors `claimUpdate` (update-log.ts:47-62).
- **`finishRun(db, key, attempt, now)`** runs `UPDATE ... SET status = 'done', finished_at = ?` with `WHERE` on the key, `status = 'running' AND attempts = ?`. `last_error` is kept as the error of the most recent failed attempt.
- **`failRun(db, key, attempt, error, now)`** sets `status = 'failed'`, `last_error` to the error message cut to its first 500 characters, and `finished_at`, under the same `WHERE`. The message is `error.message` for an `Error`, and `String(error)` otherwise, as in `failUpdate` (update-log.ts:98).
- **`recordSkipped(db, { job, scheduledDate, scheduledHour, now })`** runs `INSERT ... VALUES (..., 'skipped', 0, ?now) ON CONFLICT (job, scheduled_date) DO NOTHING RETURNING job`. It returns `true` only when it wrote the row, so a skip is logged once.
- **`latestRuns(db)`** reads the record with the greatest scheduled date for each job, joined to `SELECT job, MAX(scheduled_date) ... GROUP BY job`.

Matching the attempt in `finishRun` and `failRun` means an attempt can close only its own claim. With a 15-minute wall-time cap and a 30-minute lease, a reclaim cannot happen while the first attempt is alive. The guard makes that safe without relying on timing.

**The scheduler runs a job at least once per date (D12).** If an attempt is killed, or its outcome cannot be saved, the record stays `running`, and the next tick in the window more than 30 minutes later runs the job again. The alternative leaves `running` records alone and never re-runs them. Then a killed backup or digest is silently lost. Each job's own issue makes its side effects safe to repeat. The epic already asks this of EB-10: "WHEN the job runs again for the same period THEN no second message is sent".

### Decision 7: What a job receives, and the Telegram client (D18, D19, D20)

`JobContext` in `src/gateway/registry.ts` gains one field:

```ts
export interface JobContext {
  env: Env;
  db: D1Database;
  now: Date;            // the scheduler's clock when this job starts
  timezone: string;     // the validated household timezone
  chatId: number;       // the allowed chat id, read once in this tick
  api: Api;             // grammY's Telegram client
  /**
   * The local date (YYYY-MM-DD, household timezone) of the slot this run belongs to.
   * Decide the day, week or month a job covers from this, never from `now`:
   * a run up to 3 hours late still belongs to its scheduled date.
   */
  scheduledDate: string;
}
```

The client is `new Api(config.botToken, { fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch })`. `buildBot` passes `fetch` the same way (src/gateway/bot.ts:17-22). The global `fetch` is looked up at call time, so the Telegram stub in the tests intercepts it. One client is built per tick.

When no chat id is stored, the job is not called and the run fails with `No allowed chat id is stored`. Before setup is finished, this shows in `/ping` as a failed job. It is retried when the chat id appears within the window. `chatId` stays a `number` in the type, so jobs never handle `null`.

### Decision 8: Schedule validation (D15, D16)

`validateJobs(jobs)` runs in `createScheduler`. It runs at module scope in `src/index.ts`, so a bad registration fails the Worker at startup, like `buildRegistry`. It throws the gateway's `RegistrationError`, and each message names the job, its module, the field and the rule:

| Field | Rule | Example message |
|---|---|---|
| name | `/^[a-z0-9_]{1,32}$/` | `Job name "Nudge" in module "nudge" must be 1 to 32 of a-z, 0-9 and _` |
| every | `day`, `week` or `month` | `Job "x" in module "m" has an unknown schedule kind` |
| hour | integer 0 to 23 | `Job "nudge" in module "nudge" has hour 24; the hour must be a whole number from 0 to 23` |
| weekday | integer 1 to 7 | `...has weekday 0; the weekday must be a whole number from 1 (Monday) to 7 (Sunday)` |
| day | integer 1 to 28 | `...has day 29; the day must be a whole number from 1 to 28` |

Days are limited to 1 to 28 (D16) because the only monthly job in the epic runs on the 1st. A "last day of the month" rule would need a clamping policy that no job asks for.

This validation lives in the scheduler, not in `buildRegistry`. The `bot-gateway` spec keeps its current "Registration validation" requirement, and the rules sit in the capability that uses them.

### Decision 9: `/ping` lines (D24, D25, D32)

```ts
export const scheduler: FeatureModule = {
  name: "scheduler",
  status: async (ctx) =>
    formatStatusLines(ctx.gateway.registry.jobs, await latestRuns(ctx.gateway.db), ctx.gateway.now),
};
```

`formatStatusLines(jobs, runs, now)` is pure:

- With no jobs, it returns `["Jobs: none registered"]`.
- Otherwise it returns one line per job, in registration order:
  - `Job <name>: not run yet` when the job has no record;
  - `Job <name>: <state> · <slot>` otherwise.

The state is the stored status, except that a `running` record started more than `LEASE_MS` before `now` shows as `interrupted`. A `failed` state gets ` · 1 attempt` or ` · <n> attempts`. The slot is `<Mon> <d> <HH>:00`, formatted from the stored date and hour with a fixed English month list. It needs no timezone conversion, because the stored values are already household time. The result matches the `/ping` time format (src/core/index.ts:62-71).

When `latestRuns` throws, the gateway's existing handling shows `scheduler: status unavailable` and still sends the reply.

### Decision 10: Log entries (D23)

Each line is `console.log(JSON.stringify(entry))`, as in the gateway (src/gateway/index.ts:198-201).

| Event | Fields |
|---|---|
| `config_invalid` | `setting` |
| `database_unavailable` | `job` when it concerns one job |
| `job_done`, `job_failed` | `job`, `scheduled_date`, `attempt` |
| `job_skipped` | `job`, `scheduled_date` |
| `run_not_recorded` | `job`, `scheduled_date`, `attempt` |
| `tick_failed` | none |

No entry holds an error message or text a job sent. The error is kept in `job_runs.last_error` only.

### Decision 11: Tests (D27, D28)

**Harness.** `createScheduledController({ scheduledTime })` and `createExecutionContext()` come from `cloudflare:test` (@cloudflare/vitest-plugin 1.3.1, already pinned). A new helper, `test/helpers/scheduler.ts`, provides:
- `tick(scheduler, iso, testEnv = env)`, which calls `scheduled` and waits on the execution context;
- `insertRun(db, row)` and `readRun(db, job, date)`;
- `logEntries(spy)`, which parses the JSON log lines captured by `vi.spyOn(console, "log")` (test/allowlist.test.ts:28).

Jobs come from `probeModule({ jobs: [{ name, schedule }] })`. A probe records `job:<name>` with its `JobContext`, and `failWith(error, "job:<name>")` makes it throw (test/helpers/probe.ts). Database failures come from `failingDb` with `failWhen` on the SQL text. `test/helpers/db.ts` adds `job_runs` to `TABLES`.

**Files.**

| File | Covers |
|---|---|
| `test/unit/scheduler-schedule.test.ts` | `localTime` (Manila on both sides of midnight, Kolkata, New York on 2026-03-08 and 2026-11-01), `latestSlot` (the table in Decision 3 plus weekday and year-boundary rows), `validateJobs` (every row of Decision 8 and the valid limits) |
| `test/unit/scheduler-status.test.ts` | `formatStatusLines`, one row per line shape |
| `test/job-runs.test.ts` | Each store function against D1, and each `CHECK` rejecting a bad row |
| `test/scheduler.test.ts` | Every tick scenario of `specs/job-scheduler/spec.md`, named after it, in `describe` blocks named after the requirements |
| `test/scheduler-ping.test.ts` | The `/ping` scenarios, through `createGateway({ modules: [core, scheduler, probe.module] })` and `fetch` |
| `test/entry.test.ts` | The deployed entry exports `scheduled`. A tick with no jobs registered completes. `/ping` shows `Jobs: none registered` |
| `scripts/wrangler-config.test.mjs` | `wrangler.jsonc`, with whole-line `//` comments stripped, has `triggers.crons` equal to `["0 * * * *"]` |

**The stub guard.** The task list writes failing tests first. The stubs call `notImplemented()` (src/gateway/not-implemented.ts). Every test calls into the scheduler and asserts a value, a row or a log line that a stub cannot produce. The review confirms that each new test file fails against the stubs.

### Decision 12: Query budget

One tick costs one statement for the pre-read, one for the chat id when anything runs, two per run (claim and outcome), and one per skip. A quiet tick costs one statement. The worst case with the four jobs the epic plans is 10 statements, which leaves 40 of the 50 for the jobs' own queries. The only jobs whose slots can fall in one tick are catch-ups, and the epic's hours are 08:00, 19:00, 21:00 and 23:00.

## Risks / Trade-offs

- **A job can run twice for one date** → This happens when an attempt is killed or its outcome cannot be saved (Decision 6). It is documented on `JobContext`, and each job's issue must make its side effects safe to repeat. EB-10 already has that scenario.
- **The first deploy records skips** → The latest slot of every job is usually more than 3 hours old at deploy time, so the first tick records it as `skipped`, and `/ping` shows `skipped` until the next slot. The record is honest: the job did not run for that date.
- **An attempt killed on its last try in the window stays `running`** → `/ping` shows it as `interrupted` until the next slot's record replaces it.
- **CPU limit of 10 ms** → The tick builds one `Intl.DateTimeFormat` and one `Api`, and runs a few statements. Network and database waits do not count. The jobs themselves are the risk, and EB-12 already bounds its backup.
- **The pre-read's bound parameters** → D1 allows 100 per statement, which is 50 jobs. The epic plans 4.
- **A timezone change between ticks** → Slots are computed in the new timezone from the next tick. A record keyed under the old timezone's date can make one slot run twice or not at all. This is accepted for a setting that is changed once.
- **The `(job, scheduled_date) IN (VALUES ...)` row-value form** → SQLite has supported it since 3.15. `test/job-runs.test.ts` checks it against the D1 runtime.
- **Parallel change `add-expense-capture`** → Both changes add lines to `src/modules.ts` and to `TABLES` in `test/helpers/db.ts`. Whichever merges second resolves two simple conflicts. `scheduler` has no message handler, so the capture rule "last message handler" is not affected.
- **No test profile for the ship run** → `.claude/testing/profile.json` is missing. `/interlock:fix-tests` creates it, and that is outside this change.

## Migration Plan

1. Merge and apply migration `0004` with `npm run db:migrate:remote`, before the deploy.
2. `npm run deploy`. Wrangler registers the cron trigger from `wrangler.jsonc`.
3. Send `/ping` and check the line `Jobs: none registered`.

**Rollback.** Remove the trigger and redeploy the previous version. `wrangler deploy` of a config without `triggers` removes the cron. The table can stay: migration `0004` only creates a table, and nothing else reads it.

## Open Questions

These can be answered later without changing the specs, the approach or the tasks.

- Should `/ping` also show when a late run actually ran, next to its slot?
- Should a job registration be able to opt out of catch-up, for example a nudge that is only useful on time? No job asks for it yet. EB-11 can add a field if it needs one.
