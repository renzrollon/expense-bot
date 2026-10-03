# logging-nudge Specification

## Purpose
The logging nudge reminds the household, once in the evening, to log the day's expenses, and only when nothing was logged for that day. A member can answer it with one tap when there really was no spending, and that answer is recorded.

## Requirements

### Requirement: The system SHALL read the nudge settings when it starts

The bot SHALL read two settings when it starts:

| Setting | Meaning | Accepted values | When absent |
|---|---|---|---|
| `NUDGE_ENABLED` | whether the nudge is sent | `true` or `false`, as a boolean or as that text | `true` |
| `NUDGE_HOUR` | the household hour of the nudge | a whole number from 0 to 23, as a number or as text made of digits | `21` |

When the nudge is enabled, the bot SHALL register a job named `evening_nudge` that runs daily at that hour, household time. When the nudge is disabled, the bot SHALL register no such job and SHALL send no nudge. The button prefix of the nudge SHALL stay registered either way, so that a nudge sent earlier can still be answered.

When a setting holds any other value, the bot SHALL refuse to start, with an error that names the setting.

Rationale: a job's schedule is fixed when the bot starts, so the hour has to be known then, and a wrong value has to stop a deploy instead of silently moving the nudge.

#### Scenario: Happy path — the defaults
- **GIVEN** neither setting is defined
- **WHEN** the bot starts
- **THEN** the job `evening_nudge` is registered to run daily at 21

#### Scenario: Happy path — another hour
- **GIVEN** `NUDGE_HOUR` is `20`
- **WHEN** the bot starts and the tick of `2026-09-30T12:00:00Z` fires, which is 20:00 household time
- **THEN** the job `evening_nudge` runs for the scheduled date `2026-09-30`

#### Scenario: Failure — a setting that is not valid
- **WHEN** the bot starts with `NUDGE_HOUR` set to `24`, `-1`, `9.5`, `evening` or an empty text, or with `NUDGE_ENABLED` set to `maybe`, `1` or an empty text
- **THEN** the bot refuses to start, and the error names `NUDGE_HOUR` or `NUDGE_ENABLED`, whichever is not valid

#### Scenario: Edge case — the limits and both forms
- **WHEN** the bot starts with `NUDGE_HOUR` set to the text `0`, the text `23`, the number `7` or the text `07`
- **THEN** the job is registered at hour 0, 23, 7 and 7

#### Scenario: Edge case — the nudge is disabled
- **GIVEN** `NUDGE_ENABLED` is `false`, and no entry is dated 2026-09-30
- **WHEN** the bot starts and the tick of `2026-09-30T13:00:00Z` fires
- **THEN** no job named `evening_nudge` is registered, and the group receives nothing

### Requirement: The system SHALL nudge only when nothing is logged for the day

A run of `evening_nudge` SHALL send one message to the group when no active entry is dated its scheduled date and the day is not recorded as a no-spending day. The message SHALL be plain text:

`🌙 Nothing logged for <date> yet. Send an expense, or tap below if there was none.`

It SHALL carry one button, `No spending today`, with the data `n:<scheduled date>`, where the date is written as `YYYY-MM-DD`. The date in the text SHALL be the scheduled date, written as the short English month and the day, such as `Sep 30`. The message SHALL name no member.

When at least one active entry is dated the scheduled date, or the day is already recorded as a no-spending day, the run SHALL send nothing. The nudge SHALL be sent at most once for a scheduled date, through the scheduler's send record. When the message cannot be sent, the run SHALL fail, so that the scheduler runs it again while it is due. The job SHALL be registered with a catch-up window of 2 hours, as the `job-scheduler` requirement "The system SHALL give each job its own catch-up window" defines, so a nudge more than 2 hours late is skipped.

Rationale: forgetting is the main reason tracking lapses. One conditional reminder helps, and more reminders add nothing. A nudge that comes hours late, with a notification sound, reaches people who have gone to bed.

#### Scenario: Happy path — nothing was logged
- **GIVEN** no entry is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** chat `-1001` receives one message, `🌙 Nothing logged for Sep 30 yet. Send an expense, or tap below if there was none.`
- **AND** it has one button, `No spending today`, with the data `n:2026-09-30`

#### Scenario: Happy path — something was logged
- **GIVEN** one active entry is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** the group receives nothing, and the run record of `evening_nudge` for `2026-09-30` is `done`

#### Scenario: Failure — the message cannot be sent
- **GIVEN** no entry is dated 2026-09-30, and sending fails when the tick of `2026-09-30T13:00:00Z` fires
- **WHEN** the tick of `2026-09-30T14:00:00Z` fires and sending works again
- **THEN** the run record was `failed` after the first tick, and the group has received the nudge exactly once

#### Scenario: Edge case — the day's only entries were removed
- **GIVEN** the only entry dated 2026-09-30 was removed
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** the group receives the nudge

#### Scenario: Edge case — an entry typed today for another day
- **GIVEN** Ana typed `kahapon lunch 250` on 2026-09-30, so the entry is dated 2026-09-29, and nothing is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T13:00:00Z` fires
- **THEN** the group receives the nudge

#### Scenario: Edge case — the job runs again for the same day
- **GIVEN** the nudge for `2026-09-30` was sent
- **WHEN** `evening_nudge` runs again for `2026-09-30`
- **THEN** the group receives no second nudge

#### Scenario: Edge case — a late run names its own day
- **GIVEN** `NUDGE_HOUR` is 23, the tick of 23:00 on 2026-09-30 was missed, and no entry is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T16:00:00Z` fires, which is 00:00 on 2026-10-01 in household time
- **THEN** the nudge says `Nothing logged for Sep 30 yet`, and its button carries the data `n:2026-09-30`

#### Scenario: Edge case — 2 hours late still nudges
- **GIVEN** the ticks of 21:00 and 22:00 on 2026-09-30 were missed, and no entry is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T15:00:00Z`, 23:00 household time, fires
- **THEN** the group receives the nudge for Sep 30

#### Scenario: Failure — more than 2 hours late
- **GIVEN** the ticks of 21:00, 22:00 and 23:00 on 2026-09-30 were missed, and no entry is dated 2026-09-30
- **WHEN** the tick of `2026-09-30T16:00:00Z`, 00:00 on 2026-10-01 household time, fires
- **THEN** the group receives nothing, and the run record of `evening_nudge` for `2026-09-30` is `skipped`

### Requirement: The system SHALL record a no-spending day when the button is tapped

A press with the data `n:<date>` SHALL record that date as a no-spending day, with the member who pressed and the time, when no active entry is dated that date. The nudge SHALL then be edited in place to the one line `✅ No spending on <date>.`, with no button, and the press SHALL be answered with the notice `Noted.` The edited message SHALL name no member. A date SHALL be recorded at most once. A later press for a recorded date SHALL keep the first record and SHALL be answered the same way.

When at least one active entry is dated that date at the time of the press, the day SHALL NOT be recorded. The nudge SHALL be edited in place to the one line `👍 <date> has entries now.`, with no button, and the press SHALL be answered with the notice `Entries were logged for that day.`

When the data does not hold a real calendar date written as `YYYY-MM-DD`, nothing SHALL change, no message SHALL be edited, and the press SHALL be answered with the notice `This button no longer works.`

Editing the nudge and answering the press SHALL follow the rules of the `entry-corrections` requirement "The system SHALL keep corrections safe to repeat": the record is made first, an edit that Telegram refuses as a bad request does not fail the attempt, and the answer is sent last and never fails the attempt.

Rationale: a day without spending is an answer too, and recording it with one tap ends the reminder without a typed reply.

#### Scenario: Happy path — a member taps the button
- **GIVEN** the nudge for 2026-09-30 was sent, and no entry is dated 2026-09-30
- **WHEN** Ana taps `No spending today` at `2026-09-30T13:05:00Z`
- **THEN** 2026-09-30 is recorded as a no-spending day, by 1001, at that time
- **AND** the nudge is edited to `✅ No spending on Sep 30.` with no button, the press is answered with the notice `Noted.`, and the bot posts no new message

#### Scenario: Failure — data that does not hold a date
- **WHEN** a member presses a button with the data `n:`, `n:today`, `n:2026-02-30` or `n:2026-9-30`
- **THEN** no day is recorded, no message is edited, and the press is answered with the notice `This button no longer works.`

#### Scenario: Edge case — both members tap
- **GIVEN** Ana's tap recorded 2026-09-30
- **WHEN** Ben presses a button with the data `n:2026-09-30` a moment later
- **THEN** the record still names 1001 and Ana's time, and Ben's press is answered with the notice `Noted.`

#### Scenario: Edge case — an expense was logged before the tap
- **GIVEN** the nudge for 2026-09-30 was sent, and Ben then logged `dinner 400` dated 2026-09-30
- **WHEN** Ana taps `No spending today`
- **THEN** 2026-09-30 is not recorded as a no-spending day
- **AND** the nudge is edited to `👍 Sep 30 has entries now.` with no button, and the press is answered with the notice `Entries were logged for that day.`

#### Scenario: Edge case — the tap comes the next morning
- **GIVEN** the nudge for 2026-09-30 was sent, and no entry is dated 2026-09-30
- **WHEN** Ana taps `No spending today` at 07:00 on 2026-10-01 in household time
- **THEN** 2026-09-30 is the day that is recorded, and the nudge is edited to `✅ No spending on Sep 30.`

#### Scenario: Edge case — a recorded day is not nudged again
- **GIVEN** 2026-09-30 is recorded as a no-spending day, and no send record exists for its nudge
- **WHEN** `evening_nudge` runs for `2026-09-30`
- **THEN** the group receives nothing
