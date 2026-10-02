## Why

The weekly digest, the monthly recap, the evening nudge and the nightly backup (EB-10, EB-11, EB-12) must each run once at a local time, with no incoming message to trigger them. One shared scheduler saves writing that logic three times, and it uses only one of the 5 cron triggers the free plan allows per account (docs/epic.md, EB-09). Wave 2 is blocked until it exists.

## What Changes

- **One hourly cron trigger.** `wrangler.jsonc` gains one trigger, `0 * * * *`. The Worker's entry exports a `scheduled` handler next to `fetch`.
- **Local time.** Cron expressions run in UTC. On each tick the scheduler works out the local date, hour and weekday in the household timezone, and finds each job's most recent scheduled slot at or before that time.
- **Schedules are validated at startup.** A job runs daily at an hour, weekly on a weekday at an hour, or monthly on a day at an hour. An invalid hour, weekday, day or job name stops the Worker from starting, with an error that names the job and its module. Days of the month are limited to 1 to 28, so every month has the day.
- **`job_runs` table (migration `0004`).** It holds one row per job per scheduled date. A job runs at most once for a scheduled date, even when a tick fires twice or two ticks overlap.
- **Catch-up and skip.** A job that missed its slot still runs on a later tick, up to 3 hours late. After that, the slot is recorded as skipped and does not run.
- **Failures.** A failed job is recorded with its error and retried on the next tick within the 3-hour window. One failing job does not stop the other due jobs.
- **What a job receives.** Each job receives the database, the Telegram client, the allowed chat id read at run time, the household timezone, the current time, and a new field, `scheduledDate`. That field is the local date of the slot the run belongs to, so a run that is 3 hours late still covers the right day.
- **`/ping` shows the last run of each job.** It shows the status, the scheduled time and, for a failure, the number of attempts. A new `scheduler` module supplies these lines through the status hook that the gateway already provides.
- **Clarifications of the epic.** Each one is a numbered decision in `decisions.md`.
  - The window is inclusive. A job exactly 3 hours late still runs (D8).
  - A run that failed until the window closed stays `failed` and is not relabeled `skipped` (D9).
  - The scheduler runs a job at least once for each scheduled date. A job may run twice for one date if an attempt is cut off before its outcome is saved, so each job must be safe to repeat (D12).
  - When no allowed chat id is stored, the job is not called. The run is recorded as failed and retried (D18).

### Non-goals

- The jobs themselves: the digests (EB-10), the nudge (EB-11) and the backup (EB-12).
- Minute-level schedules, more than one run per day, and cron expressions in job registrations.
- Settings that turn a job off or move it to another hour. Each job's own issue adds those, for example `NUDGE_ENABLED` and `NUDGE_HOUR` in EB-11.
- A command to run a job by hand, and any retry after the 3-hour window.
- Days 29 to 31 of the month.
- Alerts about failed jobs outside `/ping`.

## Capabilities

### New Capabilities

- `job-scheduler`: the hourly tick, schedule validation, local-time due calculation, the `job_runs` record of each job's run per scheduled date, catch-up within a 3-hour window, skip after it, failure isolation and retry, the context each job receives, and the `/ping` lines that show each job's last run.

### Modified Capabilities

None. The `bot-gateway` requirement "Job registration" says that capability records jobs and does not run them. That stays true, because running jobs belongs to `job-scheduler`. `/ping` already shows status lines from modules, so the new lines need no change to "Ping command".

## Impact

- **Code.** A new directory `src/scheduler/` with `schedule.ts`, `store.ts`, `status.ts` and `index.ts`. `src/index.ts` gains the `scheduled` handler. `src/modules.ts` gains one line for the `scheduler` module. `JobContext` in `src/gateway/registry.ts` gains `scheduledDate`. The gateway design expected this kind of change when it defined the type ahead of EB-09.
- **Database.** Migration `0004_job_scheduler.sql` creates `job_runs`. Run `npm run db:migrate:remote` before the deploy that adds it.
- **Configuration.** `wrangler.jsonc` gains `triggers.crons`. No new secret or setting. The scheduler reads the gateway's existing settings and uses them only if they are valid.
- **Dependencies.** None added. It uses grammY's `Api` class (grammY `1.46.0`, already pinned) and the runtime's `Intl` support.
- **Tests.** New unit and Workers-runtime tests, plus a Node test that checks the cron trigger in `wrangler.jsonc`. `test/helpers/db.ts` gains `job_runs` in its list of tables to clean.
- **Docs.** One paragraph in the Deploy section of `docs/setup.md`.
- **Behavior of the deployed bot.** No job is registered until EB-10, EB-11 or EB-12 lands. Until then each tick returns at once, and `/ping` shows `Jobs: none registered`.
- **Parallel work.** `add-expense-capture` also edits `src/modules.ts` and `test/helpers/db.ts`. Both changes only add lines, so whichever merges second will have simple conflicts to resolve.
