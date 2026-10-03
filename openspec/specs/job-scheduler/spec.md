## Purpose

The job scheduler runs the bot's scheduled jobs, such as the digest, the nudge and the backup, once each at a local time in the household timezone, from one hourly cron trigger. It records each job's run per scheduled date, so that a job runs at most once per date, catches up after a missed tick, and shows its last run in `/ping`.

## Requirements

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

The scheduler SHALL refuse to start when a registered job is invalid. The error SHALL name the job, its module and the invalid field. A job name MUST be 1 to 32 characters of lowercase letters, digits and underscores. A schedule MUST be one of three kinds: daily at an hour, weekly on a weekday at an hour, or monthly on a day at an hour. An hour MUST be a whole number from 0 to 23. A weekday MUST be a whole number from 1, Monday, to 7, Sunday. A day MUST be a whole number from 1 to 28. A catch-up window, when given, MUST be a whole number of hours from 1 to 23 for a daily job, to 167 for a weekly job, and to 671 for a monthly job.

Rationale: a bad schedule is a programming error that should stop a deploy, not a job that never runs without anyone noticing.

#### Scenario: Happy path — valid schedules at their limits
- **GIVEN** a module registers `early` daily at 0, `sunday_late` weekly on weekday 7 at 23, `month_end` monthly on day 28 at 23, and daily, weekly and monthly jobs with catch-up windows of 23, 167, 671 and 1 hours
- **WHEN** the scheduler starts
- **THEN** it starts, and holds the jobs in registration order

#### Scenario: Failure — hour out of range
- **GIVEN** the module `nudge` registers the job `nudge` daily at hour 24
- **WHEN** the scheduler starts
- **THEN** it fails to start with a registration error that names the job `nudge`, the module `nudge` and the hour

#### Scenario: Edge case — values just outside each limit
- **GIVEN** a module registers exactly one of these jobs: monthly on day 29, monthly on day 0, weekly on weekday 0, weekly on weekday 8, daily at hour -1, daily at hour 8.5, or daily with the name `Nudge`
- **WHEN** the scheduler starts
- **THEN** it fails to start in each case, with a registration error that names the job, the module and the invalid field

#### Scenario: Failure — a catch-up window outside its limits
- **GIVEN** a module registers exactly one job with one of these catch-up windows: 24 hours for a daily job, 168 for a weekly job, 672 for a monthly job, 0, 1.5, or the text `3`
- **WHEN** the scheduler starts
- **THEN** it fails to start in each case, with a registration error that names the job, the module and the catch-up window

### Requirement: The system SHALL run due jobs by household time

On each tick the scheduler SHALL find each job's latest slot in household time. A job is **due** when the time from its latest slot to the tick, counted in local clock time, is no longer than the job's catch-up window. The scheduler SHALL run each due job whose run record allows it, as defined in "The system SHALL run a job at most once per scheduled date". It SHALL run due jobs one after another, in registration order, and SHALL start a job only after the previous job has finished.

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
- **GIVEN** a job `digest` registered weekly on weekday 7 at 19, and a job `recap` registered monthly on day 1 at 8, both without a catch-up window of their own
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

### Requirement: The system SHALL catch up missed jobs within their catch-up window and skip them after

A job whose slot was missed SHALL run on a later tick, as long as the time from the slot to that tick is no longer than the job's catch-up window. When the time from a job's latest slot to a tick is longer than that, and no run record exists for that scheduled date, the scheduler SHALL NOT run the job. It SHALL create a run record for that date with status `skipped` and 0 attempts. A run record that is `failed` or `running` SHALL keep its status after the window has passed. The scenarios below use a job without a window of its own, so its window is 3 hours.

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

The state is `done`, `failed`, `skipped` or `running`. A record that is `running` with a last attempt that started more than 30 minutes before `/ping` is shown as `interrupted`. A `failed` state is followed by ` · 1 attempt` or ` · <n> attempts`, and then, when the record holds a last error, by ` · <reason>`. The reason is the first line of the last error, with each run of spaces made one, and cut to 60 characters, the last of them `…`, when it is longer. The slot is the scheduled date and hour: a short month name, the day without a leading zero, and the hour as two digits followed by `:00`. The scheduler SHALL NOT show records of jobs that are no longer registered.

Rationale: `/ping` is the household's only health check, and the epic asks it to show each job's last run. The reason says what to fix without a database query. `/ping` answers only in the household's own group, so the error text stays with the people whose ledger it may describe.

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
  - `a` has a record for `2026-09-30` that is `failed` with 1 attempt and no last error;
  - `b` has a record for `2026-09-30` that is `failed` with 2 attempts and the last error `Network request for 'sendMessage' failed!`;
  - `c` has a record for `2026-09-30` that is `running`, with an attempt that started 45 minutes before `/ping`;
  - `d` has a record for `2026-09-29` that is `done` and a record for `2026-09-30` that is `skipped`;
- **AND** the database holds a record for a job `old` that is no longer registered
- **WHEN** a member sends `/ping`
- **THEN** the scheduler lines are exactly `Job a: failed · Sep 30 21:00 · 1 attempt`, `Job b: failed · Sep 30 21:00 · 2 attempts · Network request for 'sendMessage' failed!`, `Job c: interrupted · Sep 30 21:00` and `Job d: skipped · Sep 30 21:00`

#### Scenario: Edge case — a long reason on two lines
- **GIVEN** a job `nightly` whose record is `failed` with 1 attempt and the last error `Call to 'sendDocument' failed!   (400: Bad Request: chat not found)`, then a line break and `at stack`
- **WHEN** a member sends `/ping`
- **THEN** its line is `Job nightly: failed · Sep 30 21:00 · 1 attempt · Call to 'sendDocument' failed! (400: Bad Request: chat not…`

#### Scenario: Edge case — no job registered
- **GIVEN** no module registers a job
- **WHEN** a member sends `/ping`
- **THEN** the scheduler shows the one line `Jobs: none registered`

### Requirement: The system SHALL log run outcomes without their content

The scheduler SHALL write one single-line JSON log entry each time it records an outcome. The events are `job_done`, `job_failed` and `job_skipped`. Each entry SHALL name the job and the scheduled date. Entries for `job_done` and `job_failed` SHALL also give the attempt number. An entry for `job_failed` SHALL also give a `reason`: `telegram_<code>` when Telegram refused a call with that error code, `telegram_unreachable` when a call to Telegram got no answer or timed out, `database` for an error from the database, and `other` for any other error. No log entry SHALL hold an error message or any text a job sent.

Rationale: logs are visible in the Cloudflare dashboard, and an error message can carry ledger content. A reason code tells the kind of failure apart without the message.

#### Scenario: Happy path — a done run is logged
- **GIVEN** a job `nightly` registered daily at 21
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires and `nightly` succeeds
- **THEN** one log entry has the event `job_done`, the job `nightly`, the scheduled date `2026-09-30` and the attempt 1

#### Scenario: Failure — a failed run is logged without its error
- **GIVEN** a job `nightly` registered daily at 21 that fails with the error `lunch 250 by Ana`
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** one log entry has the event `job_failed`, the job `nightly`, the scheduled date `2026-09-30`, the attempt 1 and the reason `other`
- **AND** no log entry contains `lunch 250 by Ana`

#### Scenario: Failure — a refused Telegram call is logged with its code
- **GIVEN** a job `hello` registered daily at 21 whose message Telegram refuses with error 403 and `Forbidden: bot was kicked from the supergroup chat`
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** one log entry has the event `job_failed`, the job `hello`, the scheduled date `2026-09-30`, the attempt 1 and the reason `telegram_403`
- **AND** no log entry contains `kicked`

#### Scenario: Edge case — a skip is logged once
- **GIVEN** a job `nightly` registered daily at 21 with no run record
- **WHEN** the ticks of `2026-09-30T17:00:00Z` and `2026-09-30T18:00:00Z` fire
- **THEN** exactly one log entry has the event `job_skipped`, the job `nightly` and the scheduled date `2026-09-30`, and it gives no attempt number

### Requirement: The system SHALL let a job send each message once per scheduled date

The scheduler SHALL keep a send record for jobs. A record is identified by a job name, a scheduled date and a part name, where the part names one of the messages a job sends for one scheduled date. A job that sends through the send record SHALL get this behavior:

- When no record exists for the key, the send SHALL be performed. After it succeeds, a record SHALL be stored with the chat id and the message id of the sent message and the time.
- When a record exists for the key, the send SHALL NOT be performed, and the job SHALL be told that the message was already sent.
- When the send fails, the error SHALL pass on to the job, and no record SHALL be stored, so that a later run sends the message.
- When the send succeeds and the record cannot be stored, the job SHALL NOT fail. The scheduler SHALL write one log entry with the event `job_send_unsaved`, the job, the scheduled date and the part, and with no message content.

Rationale: the scheduler runs a job at least once for each scheduled date. A run whose outcome could not be saved is run again, and without a record of what it sent, it would send its message a second time.

#### Scenario: Happy path — a second run sends nothing
- **GIVEN** a job `hello` that sends the text `hi` through the send record, with the part `greeting`, and its run for `2026-09-30` sent the message
- **WHEN** `hello` runs again for `2026-09-30`
- **THEN** Telegram receives nothing more, and the job is told the message was already sent
- **AND** the record for `hello`, `2026-09-30` and `greeting` holds the chat id `-1001` and the id of the first message

#### Scenario: Failure — the send fails
- **GIVEN** a job `hello` whose send fails on its run for `2026-09-30`
- **WHEN** the run ends
- **THEN** the job received the error, and no record exists for `hello`, `2026-09-30` and `greeting`
- **AND** when `hello` runs again for `2026-09-30` and the send succeeds, Telegram receives the message once

#### Scenario: Edge case — the record cannot be saved
- **GIVEN** a job `hello` whose send succeeds, and storing the record then fails
- **WHEN** the run ends
- **THEN** the job did not fail, and Telegram received the message once
- **AND** one log entry holds the event `job_send_unsaved`, the job `hello`, the scheduled date `2026-09-30` and the part `greeting`, and no message text

#### Scenario: Edge case — parts and dates are separate keys
- **GIVEN** a job `backup` that sends one message with the part `entries` and one with the part `keywords`
- **WHEN** it runs for `2026-09-30`, runs again for `2026-09-30`, and then runs for `2026-10-01`
- **THEN** Telegram receives four messages: both parts for `2026-09-30` once, and both parts for `2026-10-01` once

### Requirement: The system SHALL tell the group when a job that asks for it did not finish

A job MAY ask for a failure alert when it is registered. For such a job, when a tick finds that the job's latest slot is older than the job's catch-up window, and the run record of that slot is `failed`, or is `running` with an attempt that started more than 30 minutes ago, the scheduler SHALL send one message to the allowed chat:

```
⚠️ Job <name> did not finish · <Mon> <d> <HH>:00 · <state>, <n> attempts
It is not tried again for that date. /ping shows each job's last run.
```

`<state>` is `failed` or `interrupted`, as `/ping` shows it, and the text says `1 attempt` when the count is 1.

When the run record of that slot is `skipped` and the job has a run record for an earlier scheduled date, the scheduler SHALL send this message instead:

```
⚠️ Job <name> did not run · <Mon> <d> <HH>:00 · skipped
No tick came in its catch-up window, so it is not tried again for that date. /ping shows each job's last run.
```

Either message SHALL be sent without a notification sound. It SHALL be sent at most once for the job and the scheduled date, through the send record with the part `failure_alert`. When it cannot be sent, the tick SHALL log `job_alert_failed` and go on, and a later tick SHALL try again while the slot is still the job's latest. A sent alert SHALL be logged as `job_alert_sent`. Both log entries SHALL hold the job name and the scheduled date and nothing else.

The scheduler SHALL send no alert for a run that is `done`, none for a `skipped` run of a job that has no run record for an earlier date, and none for a job that did not ask. An alert SHALL NOT change the run record.

Rationale: a run that fails is tried again only inside its catch-up window, and after that only `/ping` shows it. An attempt cannot know that it is the last one, and an attempt that is stopped runs no more code, so the alert comes from a later tick. A skipped run means no tick came while the job was due, which loses a backup as surely as a failure. The first skip of a job that never ran is what every first deploy records, so it is not a fault.

#### Scenario: Happy path — a run that finished
- **GIVEN** a job that asks for an alert ran at 23:00 on `2026-09-30` and is `done`
- **WHEN** the tick of 03:00 on `2026-10-01` fires
- **THEN** no alert is sent

#### Scenario: Failure — every attempt in the window fails
- **GIVEN** the job `nightly_backup` failed at 23:00, 00:00, 01:00 and 02:00 for the scheduled date `2026-09-30`
- **WHEN** the ticks of 03:00 and 04:00 fire
- **THEN** the group receives one message, without a notification sound, whose first line is `⚠️ Job nightly_backup did not finish · Sep 30 23:00 · failed, 4 attempts`
- **AND** the run record is still `failed` with 4 attempts

#### Scenario: Failure — the alert cannot be sent
- **GIVEN** a failed run whose window has ended, and Telegram refuses the message at 03:00
- **WHEN** the ticks of 03:00 and 04:00 fire
- **THEN** the tick of 03:00 logs `job_alert_failed`, and the tick of 04:00 sends the alert

#### Scenario: Edge case — an attempt that was cut off
- **GIVEN** the run record is `running`, with 2 attempts, the last started at 00:00
- **WHEN** the tick of 03:00 fires
- **THEN** the alert's first line is `⚠️ Job nightly_backup did not finish · Sep 30 23:00 · interrupted, 2 attempts`

#### Scenario: Edge case — the first skip of a new database
- **GIVEN** `nightly_backup` has no run record, and no tick fired between 23:00 and 02:00, so the tick of 03:00 records the run of `2026-09-30` as `skipped`
- **WHEN** the ticks of 03:00 and 04:00 fire
- **THEN** no alert is sent

#### Scenario: Failure — a job that ran before is skipped
- **GIVEN** the run record of `nightly_backup` for `2026-09-29` is `done`, and no tick fired between 23:00 and 02:00 on `2026-09-30`
- **WHEN** the ticks of 03:00, 04:00 and 05:00 fire
- **THEN** the tick of 03:00 records the run of `2026-09-30` as `skipped`
- **AND** the group receives one message, without a notification sound, whose first line is `⚠️ Job nightly_backup did not run · Sep 30 23:00 · skipped`
- **AND** the run record is still `skipped` with 0 attempts

#### Scenario: Edge case — a job that did not ask
- **GIVEN** a job registered without a failure alert has a `failed` run whose window has ended
- **WHEN** a tick fires
- **THEN** nothing is sent to the group

### Requirement: The system SHALL give each job its own catch-up window

A job MAY give a catch-up window when it is registered: a whole number of hours from 1 to the longest window of its schedule kind, which is 23 for a daily job, 167 for a weekly job and 671 for a monthly job, so that the window always ends before the job's next slot. A job that gives none SHALL have a window of 3 hours.

Rationale: a digest that is a day late is still worth reading, but a nudge that is three hours late reaches people who have gone to bed. One window for every job got both wrong.

#### Scenario: Happy path — two jobs with their own windows
- **GIVEN** a job `digest` registered weekly on weekday 3 at 21 with a window of 48 hours, and a job `nudge` registered daily at 21 with a window of 1 hour, neither with a run record
- **WHEN** the tick of `2026-09-30T15:00:00Z`, Wednesday 23:00 household time, fires
- **THEN** `digest` runs with scheduled date `2026-09-30`
- **AND** `nudge` does not run, and its run record for `2026-09-30` is `skipped`

#### Scenario: Edge case — the end of a 48-hour window
- **GIVEN** a job `digest` registered weekly on weekday 3 at 21 with a window of 48 hours and no run record
- **WHEN** the tick of `2026-10-02T13:00:00Z`, exactly 48 hours after the slot, fires
- **THEN** `digest` runs with scheduled date `2026-09-30`
- **AND** had the first tick been `2026-10-02T14:00:00Z`, `digest` would not run and its run record would be `skipped`
