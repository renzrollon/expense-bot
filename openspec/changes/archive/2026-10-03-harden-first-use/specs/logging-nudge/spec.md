## MODIFIED Requirements

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
