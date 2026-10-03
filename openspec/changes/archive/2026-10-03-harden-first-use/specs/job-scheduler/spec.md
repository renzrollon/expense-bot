## ADDED Requirements

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

## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: The system SHALL catch up missed jobs within 3 hours and skip them after`
- TO: `### Requirement: The system SHALL catch up missed jobs within their catch-up window and skip them after`
