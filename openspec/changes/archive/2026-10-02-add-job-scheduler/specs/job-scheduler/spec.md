## Purpose

The job scheduler runs the bot's scheduled jobs, such as the digest, the nudge and the backup, once each at a local time in the household timezone, from one hourly cron trigger. It records each job's run per scheduled date, so that a job runs at most once per date, catches up after a missed tick, and shows its last run in `/ping`.

## ADDED Requirements

In every scenario of this specification, unless the scenario says otherwise:

- the household timezone is `Asia/Manila`, which is UTC+8 with no daylight saving time;
- the settings are valid, and the allowed chat id stored in the settings is `-1001`;
- the scheduler's clock reads the tick's scheduled time;
- 2026-09-30 is a Wednesday. The tick at `2026-09-30T13:00:00Z` is 21:00 household time on 30 September.

A **slot** is a local date and hour that a job's schedule names. A job's **latest slot** for a tick is the most recent slot at or before the tick, in household time. The slot's local date is the job's **scheduled date**. A job's **run record** is the scheduler's record for one job and one scheduled date.

### Requirement: The system SHALL run the scheduler from one hourly trigger

The Worker SHALL have exactly one cron trigger. It SHALL fire at the start of every UTC hour and be handled by the scheduler. The scheduler SHALL evaluate schedules at the tick's scheduled time, not the time the handler starts. When no job is registered, a tick SHALL end without reading the settings or the database. When the settings are missing or invalid, a tick SHALL run no job, write no run record, and write one log entry `config_invalid` that names the setting. A tick SHALL complete without throwing an error, whatever fails during it.

Rationale: cron expressions run in UTC and the free plan allows 5 triggers per account, so one hourly trigger serves every job.

#### Scenario: Happy path — one hourly trigger
- **GIVEN** the Worker configuration in the repository
- **WHEN** its cron triggers are read
- **THEN** there is exactly one trigger, `0 * * * *`
- **AND** the Worker's entry exports a scheduled handler next to its request handler

#### Scenario: Failure — invalid settings
- **GIVEN** a job `nightly` registered daily at 21, and the member list setting is missing
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** `nightly` does not run, and no run record exists
- **AND** one log entry `config_invalid` names the member list setting
- **AND** the tick completes without an error

#### Scenario: Edge case — no job registered
- **GIVEN** no module registers a job, and every database statement fails
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** the tick completes without an error and writes no log entry

#### Scenario: Edge case — the handler starts late
- **GIVEN** a job `nightly` registered daily at 21
- **WHEN** the tick scheduled for `2026-09-30T13:00:00Z` starts at `2026-09-30T13:04:00Z` by the scheduler's clock
- **THEN** `nightly` runs once with scheduled date `2026-09-30`
- **AND** its run record's attempt start time is `2026-09-30T13:04:00.000Z`

### Requirement: The system SHALL validate job schedules at startup

The scheduler SHALL refuse to start when a registered job is invalid. The error SHALL name the job, its module and the invalid field. A job name MUST be 1 to 32 characters of lowercase letters, digits and underscores. A schedule MUST be one of three kinds: daily at an hour, weekly on a weekday at an hour, or monthly on a day at an hour. An hour MUST be a whole number from 0 to 23. A weekday MUST be a whole number from 1, Monday, to 7, Sunday. A day MUST be a whole number from 1 to 28.

Rationale: a bad schedule is a programming error that should stop a deploy, not a job that never runs without anyone noticing.

#### Scenario: Happy path — valid schedules at their limits
- **GIVEN** a module registers `early` daily at 0, `sunday_late` weekly on weekday 7 at 23, and `month_end` monthly on day 28 at 23
- **WHEN** the scheduler starts
- **THEN** it starts, and holds the three jobs in registration order

#### Scenario: Failure — hour out of range
- **GIVEN** the module `nudge` registers the job `nudge` daily at hour 24
- **WHEN** the scheduler starts
- **THEN** it fails to start with a registration error that names the job `nudge`, the module `nudge` and the hour

#### Scenario: Edge case — values just outside each limit
- **GIVEN** a module registers exactly one of these jobs: monthly on day 29, monthly on day 0, weekly on weekday 0, weekly on weekday 8, daily at hour -1, daily at hour 8.5, or daily with the name `Nudge`
- **WHEN** the scheduler starts
- **THEN** it fails to start in each case, with a registration error that names the job, the module and the invalid field

### Requirement: The system SHALL run due jobs by household time

On each tick the scheduler SHALL find each job's latest slot in household time. A job is **due** when the tick is at most 3 hours after its latest slot, counted in local clock time. The scheduler SHALL run each due job whose run record allows it, as defined in "The system SHALL run a job at most once per scheduled date". It SHALL run due jobs one after another, in registration order, and SHALL start a job only after the previous job has finished.

Rationale: cron runs in UTC, but the digest, the nudge and the backup are set in household time, which is also where the day boundary falls.

#### Scenario: Happy path — daily jobs at their hour
- **GIVEN** jobs `first` and `second` are both registered daily at 21, in that order, and neither has a run record
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** `first` runs once and then `second` runs once, each with scheduled date `2026-09-30`
- **AND** each has a run record for `2026-09-30` with status `done` and 1 attempt

#### Scenario: Failure — not yet due
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-29` is `done`
- **WHEN** the tick of `2026-09-30T12:00:00Z`, 20:00 household time, fires
- **THEN** `nightly` does not run, and no run record for `2026-09-30` exists

#### Scenario: Edge case — the household date differs from the UTC date
- **GIVEN** a job `midnight` registered daily at 0
- **WHEN** the tick of `2026-09-30T16:00:00Z`, 00:00 household time on 1 October, fires
- **THEN** `midnight` runs once with scheduled date `2026-10-01`, not the UTC date `2026-09-30`

#### Scenario: Edge case — weekly and monthly slots
- **GIVEN** a job `digest` registered weekly on weekday 7 at 19, and a job `recap` registered monthly on day 1 at 8
- **WHEN** the tick of `2026-10-04T11:00:00Z`, Sunday 19:00 household time, fires
- **THEN** `digest` runs with scheduled date `2026-10-04`
- **AND** when the tick of `2026-10-01T00:00:00Z`, Thursday 1 October 08:00 household time, fires, `recap` runs with scheduled date `2026-10-01`
- **AND** when the tick of `2026-12-31T23:00:00Z`, 1 January 2027 07:00 household time, fires, the latest slot of `recap` is 1 December 2026 at 08:00, which is more than 3 hours earlier, so `recap` does not run

#### Scenario: Edge case — a timezone with a half-hour offset
- **GIVEN** the household timezone is `Asia/Kolkata`, UTC+5:30, and a job `nightly` is registered daily at 21 with no run record for `2026-09-30`
- **WHEN** the tick of `2026-09-30T15:00:00Z`, 20:30 household time, fires
- **THEN** `nightly` does not run
- **AND** when the tick of `2026-09-30T16:00:00Z`, 21:30 household time, fires, `nightly` runs once with scheduled date `2026-09-30`

### Requirement: The system SHALL run a job at most once per scheduled date

The scheduler SHALL keep at most one run record per job and scheduled date. A run record SHALL hold the job name, the scheduled date and hour, the status (`running`, `done`, `failed` or `skipped`), the number of attempts, the last error, and three UTC times: when the record was created, when the last attempt started, and when the last attempt finished. Before it runs a due job, the scheduler SHALL claim the run record in one atomic step. A claim SHALL succeed only in three cases: no record exists, the record is `failed`, or the record is `running` and its last attempt started more than 30 minutes before the claim. Each successful claim SHALL set the status to `running` and count one attempt. The scheduler SHALL run the job only after a successful claim. A job that finishes without an error SHALL be recorded as `done`.

Rationale: a cron tick can fire twice or overlap another tick, and the digest must not reach the group twice.

#### Scenario: Happy path — the same tick fires twice
- **GIVEN** a job `nightly` registered daily at 21
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires, and then fires again
- **THEN** `nightly` runs once
- **AND** its run record for `2026-09-30` is `done` with 1 attempt

#### Scenario: Failure — another tick holds the claim
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-30` is `running` with 1 attempt that started 10 minutes before the tick
- **WHEN** the tick of `2026-09-30T14:00:00Z` fires
- **THEN** `nightly` does not run, and its run record is unchanged

#### Scenario: Edge case — the claim's 30-minute boundary
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-30` is `running` with 1 attempt
- **WHEN** the tick of `2026-09-30T14:00:00Z` fires and the attempt started exactly 30 minutes earlier
- **THEN** `nightly` does not run
- **AND** when the attempt instead started 31 minutes earlier, `nightly` runs once and its run record becomes `done` with 2 attempts

#### Scenario: Edge case — a done job is not run again later in its window
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-30` is `done`
- **WHEN** the tick of `2026-09-30T14:00:00Z` fires
- **THEN** `nightly` does not run, and its run record is unchanged

### Requirement: The system SHALL catch up missed jobs within 3 hours and skip them after

A job whose slot was missed SHALL run on a later tick, as long as that tick is at most 3 hours after the slot. When a tick is more than 3 hours after a job's latest slot, and no run record exists for that scheduled date, the scheduler SHALL NOT run the job. It SHALL create a run record for that date with status `skipped` and 0 attempts. A run record that is `failed` or `running` SHALL keep its status after the 3 hours have passed.

Rationale: a late digest is still useful, but a nudge delivered the next morning is not.

#### Scenario: Happy path — a missed tick is caught up
- **GIVEN** a job `nightly` registered daily at 21 with no run record, and the tick of `2026-09-30T13:00:00Z` did not fire
- **WHEN** the tick of `2026-09-30T14:00:00Z`, 22:00 household time, fires
- **THEN** `nightly` runs once with scheduled date `2026-09-30`
- **AND** its run record is `done` with 1 attempt

#### Scenario: Failure — later than the 3-hour window
- **GIVEN** a job `nightly` registered daily at 21 with no run record
- **WHEN** the tick of `2026-09-30T17:00:00Z`, 01:00 household time on 1 October, fires
- **THEN** `nightly` does not run
- **AND** a run record for `2026-09-30` exists with status `skipped` and 0 attempts
- **AND** when the tick of `2026-09-30T18:00:00Z` fires, `nightly` does not run and no other run record is created

#### Scenario: Edge case — exactly 3 hours late
- **GIVEN** a job `nightly` registered daily at 21 with no run record
- **WHEN** the tick of `2026-09-30T16:00:00Z`, 00:00 household time on 1 October, fires
- **THEN** `nightly` runs once with scheduled date `2026-09-30`

#### Scenario: Edge case — a failed run stays failed after the window
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-30` is `failed` with 3 attempts
- **WHEN** the tick of `2026-09-30T17:00:00Z` fires
- **THEN** `nightly` does not run, and its run record is still `failed` with 3 attempts and its last error

### Requirement: The system SHALL isolate and retry failed jobs

When a job fails, the scheduler SHALL record the run as `failed`, with the error message cut to its first 500 characters and the time the attempt finished. It SHALL then go on to the next due job. A `failed` run SHALL be retried on each later tick while the job is due.

Rationale: one broken job should not silence the others, and a transient failure such as a network error deserves another try.

#### Scenario: Happy path — a failed job is retried on the next tick
- **GIVEN** a job `nightly` registered daily at 21, that fails with the error `network down` on its first attempt and succeeds on its second
- **WHEN** the ticks of `2026-09-30T13:00:00Z` and `2026-09-30T14:00:00Z` fire
- **THEN** after the first tick its run record for `2026-09-30` is `failed` with 1 attempt and last error `network down`
- **AND** after the second tick it is `done` with 2 attempts

#### Scenario: Failure — one job fails and the others still run
- **GIVEN** jobs `first` and `second` registered daily at 21, in that order, and `first` fails with the error `boom`
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** `second` runs once, and its run record is `done`
- **AND** the run record of `first` is `failed` with 1 attempt and last error `boom`

#### Scenario: Edge case — a long error message
- **GIVEN** a job `nightly` registered daily at 21 that fails with an error message of 600 characters
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** its run record's last error is the first 500 characters of that message

### Requirement: The system SHALL give each run its context

Each run SHALL receive these values:

- the environment and the database;
- the current time, which is the scheduler's clock when the job starts;
- the household timezone;
- the allowed chat id, read from the stored settings during the tick;
- a Telegram client;
- the scheduled date, as `YYYY-MM-DD`.

A job SHALL decide which day, week or month it covers from the scheduled date, not from the current time. When no allowed chat id is stored, the scheduler SHALL NOT call the job. It SHALL record the run as `failed`, with the last error `No allowed chat id is stored`, so the run is retried while the job is due.

Rationale: jobs send to the group with no incoming update to reply to, and a late run has to cover the date it was scheduled for.

#### Scenario: Happy path — a job sends to the group
- **GIVEN** a job `hello` registered daily at 21 that sends the text `hi` to the chat id it receives, through the client it receives
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** Telegram receives one message, with the text `hi`, for chat `-1001`
- **AND** the job received the timezone `Asia/Manila` and the scheduled date `2026-09-30`

#### Scenario: Failure — no allowed chat id is stored
- **GIVEN** a job `hello` registered daily at 21, and no allowed chat id is stored
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** `hello` is not called, and Telegram receives nothing
- **AND** its run record for `2026-09-30` is `failed` with 1 attempt and last error `No allowed chat id is stored`
- **AND** when the chat id `-1001` is then stored and the tick of `2026-09-30T14:00:00Z` fires, `hello` runs with chat id `-1001` and its run record becomes `done` with 2 attempts

#### Scenario: Edge case — a late run covers its scheduled date
- **GIVEN** a job `nightly` registered daily at 21 with no run record
- **WHEN** the tick of `2026-09-30T16:00:00Z` fires, which is 00:00 household time on 1 October
- **THEN** `nightly` receives the scheduled date `2026-09-30`, and a current time that falls on 1 October in household time

### Requirement: The system SHALL keep ticking through database failures

When the scheduler cannot read the run records at the start of a tick, it SHALL run no job and write one log entry `database_unavailable`. When a claim fails because of a database error, the scheduler SHALL NOT run that job on this tick, and SHALL go on to the next job. When the outcome of a run cannot be saved, the scheduler SHALL write a log entry `run_not_recorded` that names the job, and go on. A run whose outcome was not saved stays `running`, so a later tick in the job's window that comes more than 30 minutes after the attempt started runs the job again. Each job SHALL therefore be safe to run more than once for one scheduled date.

Rationale: the database can fail between two statements, and the choice is between a possible repeat and a possible silent miss. The scheduler repeats.

#### Scenario: Happy path — the database recovers by the next tick
- **GIVEN** a job `nightly` registered daily at 21, and every database statement fails during the tick of `2026-09-30T13:00:00Z`
- **WHEN** that tick fires, the database recovers, and the tick of `2026-09-30T14:00:00Z` fires
- **THEN** the first tick runs no job and writes one log entry `database_unavailable`
- **AND** the second tick runs `nightly` once, and its run record is `done` with 1 attempt

#### Scenario: Failure — one claim fails
- **GIVEN** jobs `first` and `second` registered daily at 21, and the claim for `first` fails with a database error
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** `first` does not run, and `second` runs once
- **AND** no run record for `first` exists

#### Scenario: Edge case — the outcome cannot be saved
- **GIVEN** a job `nightly` registered daily at 21, and the statement that records `done` fails during the tick of `2026-09-30T13:00:00Z`
- **WHEN** that tick fires
- **THEN** `nightly` runs once, one log entry `run_not_recorded` names `nightly`, and its run record is `running` with 1 attempt
- **AND** when the database recovers and the tick of `2026-09-30T14:00:00Z` fires, 60 minutes after the attempt started, `nightly` runs again and its run record becomes `done` with 2 attempts

### Requirement: The system SHALL show each job's last run in /ping

`/ping` SHALL show the scheduler's lines after its own lines, in the place the gateway gives to module status lines. When no job is registered, the scheduler SHALL show the one line `Jobs: none registered`. Otherwise it SHALL show one line for each registered job, in registration order:

- `Job <name>: not run yet` when the job has no run record;
- otherwise `Job <name>: <state> · <slot>`, for the run record with the latest scheduled date.

The state is `done`, `failed`, `skipped` or `running`. A record that is `running` with a last attempt that started more than 30 minutes before `/ping` is shown as `interrupted`. A `failed` state is followed by ` · 1 attempt` or ` · <n> attempts`. The slot is the scheduled date and hour: a short month name, the day without a leading zero, and the hour as two digits followed by `:00`. The scheduler SHALL NOT show records of jobs that are no longer registered.

Rationale: `/ping` is the household's only health check, and the epic asks it to show each job's last run.

#### Scenario: Happy path — one line per job
- **GIVEN** a job `nightly` registered daily at 21, whose run record for `2026-09-30` is `done`, and a job `digest` registered weekly on weekday 7 at 19, with no run record
- **WHEN** a member sends `/ping`
- **THEN** the reply's scheduler lines are `Job nightly: done · Sep 30 21:00` followed by `Job digest: not run yet`

#### Scenario: Failure — the run records cannot be read
- **GIVEN** a job `nightly` is registered, and the statement that reads the run records fails
- **WHEN** a member sends `/ping`
- **THEN** the reply is still sent, and in place of the scheduler lines it shows `scheduler: status unavailable`

#### Scenario: Edge case — states, counts and the latest record
- **GIVEN** these jobs, each registered daily at 21:
  - `a` has a record for `2026-09-30` that is `failed` with 1 attempt;
  - `b` has a record for `2026-09-30` that is `failed` with 2 attempts;
  - `c` has a record for `2026-09-30` that is `running`, with an attempt that started 45 minutes before `/ping`;
  - `d` has a record for `2026-09-29` that is `done` and a record for `2026-09-30` that is `skipped`;
- **AND** the database holds a record for a job `old` that is no longer registered
- **WHEN** a member sends `/ping`
- **THEN** the scheduler lines are exactly `Job a: failed · Sep 30 21:00 · 1 attempt`, `Job b: failed · Sep 30 21:00 · 2 attempts`, `Job c: interrupted · Sep 30 21:00` and `Job d: skipped · Sep 30 21:00`

#### Scenario: Edge case — no job registered
- **GIVEN** no module registers a job
- **WHEN** a member sends `/ping`
- **THEN** the scheduler shows the one line `Jobs: none registered`

### Requirement: The system SHALL log run outcomes without their content

The scheduler SHALL write one single-line JSON log entry each time it records an outcome. The events are `job_done`, `job_failed` and `job_skipped`. Each entry SHALL name the job and the scheduled date. Entries for `job_done` and `job_failed` SHALL also give the attempt number. No log entry SHALL hold an error message or any text a job sent.

Rationale: logs are visible in the Cloudflare dashboard, and an error message can carry ledger content.

#### Scenario: Happy path — a done run is logged
- **GIVEN** a job `nightly` registered daily at 21
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires and `nightly` succeeds
- **THEN** one log entry has the event `job_done`, the job `nightly`, the scheduled date `2026-09-30` and the attempt 1

#### Scenario: Failure — a failed run is logged without its error
- **GIVEN** a job `nightly` registered daily at 21 that fails with the error `lunch 250 by Ana`
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** one log entry has the event `job_failed`, the job `nightly`, the scheduled date `2026-09-30` and the attempt 1
- **AND** no log entry contains `lunch 250 by Ana`

#### Scenario: Edge case — a skip is logged once
- **GIVEN** a job `nightly` registered daily at 21 with no run record
- **WHEN** the ticks of `2026-09-30T17:00:00Z` and `2026-09-30T18:00:00Z` fire
- **THEN** exactly one log entry has the event `job_skipped`, the job `nightly` and the scheduled date `2026-09-30`, and it gives no attempt number
