# scheduled-digests Specification

## Purpose
Scheduled digests send the household a spending summary without being asked: a weekly digest every Sunday evening and a monthly recap on the first morning of each month. Both are built from the same report as the `/week` and `/month` commands and are sent to the group.

## Requirements

### Requirement: The system SHALL send a weekly digest on Sunday at 19:00

The bot SHALL register a job named `weekly_digest` that runs weekly, on Sunday at 19:00 household time. A run SHALL cover the 7 days that end on its scheduled date, Monday to Sunday. It SHALL send one message to the group, in plain text with link previews turned off:

- the report for that week, under the title `Weekly digest · <range>`;
- then one empty line and the line `Month to date: <amount>`, where the amount is the spending total from the 1st of the scheduled date's month to the scheduled date.

When the week has no active entry at all, the message SHALL be the one line `🌱 Nothing logged for <range>. A fresh week starts tomorrow.` The digest SHALL NOT count missed days, show a streak, or name a member.

When the message cannot be sent, the run SHALL fail, so that the scheduler runs it again while it is due.

Rationale: a summary that arrives without being asked for is what turns logged entries into decisions.

#### Scenario: Happy path — the digest of a week
- **GIVEN** the week from 2026-09-28 to 2026-10-04 holds 23 active entries: ₱3,200 in `groceries`, ₱2,150 in `dining`, ₱1,300 in `transport`, ₱1,100 in `bills` and ₱700 in `other`, and one more of ₱2,000 in `transfer`
- **AND** the entries dated from 2026-10-01 to 2026-10-04 that count as spending add up to ₱3,100
- **WHEN** the tick of `2026-10-04T11:00:00Z` fires
- **THEN** chat `-1001` receives exactly one message:

```
📊 Weekly digest · Sep 28 to Oct 4
₱8,450 · 23 entries

🛒 Groceries · ₱3,200 · 38%
🍽 Dining · ₱2,150 · 25%
🚗 Transport · ₱1,300 · 15%
💡 Bills · ₱1,100 · 13%
❓ Other · ₱700 · 8%

Not counted: 🔁 Transfers ₱2,000

Month to date: ₱3,100
```

#### Scenario: Failure — the message cannot be sent
- **GIVEN** the week holds entries, and sending fails when the tick of `2026-10-04T11:00:00Z` fires
- **WHEN** the tick of `2026-10-04T12:00:00Z` fires and sending works again
- **THEN** the run record of `weekly_digest` for `2026-10-04` was `failed` after the first tick and is `done` after the second
- **AND** the group has received the digest exactly once

#### Scenario: Edge case — a week without entries
- **GIVEN** no active entry is dated from 2026-09-28 to 2026-10-04
- **WHEN** the tick of `2026-10-04T11:00:00Z` fires
- **THEN** the group receives the one line `🌱 Nothing logged for Sep 28 to Oct 4. A fresh week starts tomorrow.`

#### Scenario: Edge case — a late run covers its own week
- **GIVEN** the ticks of 19:00 and 20:00 on Sunday 2026-10-04 were missed, and an entry dated 2026-09-27 exists
- **WHEN** the tick of `2026-10-04T13:00:00Z` fires, which is 21:00 household time
- **THEN** the digest's title is `Weekly digest · Sep 28 to Oct 4`, and the entry dated 2026-09-27 is not in it

#### Scenario: Edge case — the month to date starts on the 1st
- **GIVEN** the week holds ₱5,000 of spending dated 2026-09-30 and ₱300 dated 2026-10-02, and October holds nothing else
- **WHEN** the tick of `2026-10-04T11:00:00Z` fires
- **THEN** the digest's second line is `₱5,300 · 2 entries`, and its last line is `Month to date: ₱300`

### Requirement: The system SHALL send a monthly recap on the 1st at 08:00

The bot SHALL register a job named `monthly_recap` that runs monthly, on day 1 at 08:00 household time. A run SHALL cover the calendar month before its scheduled date. It SHALL send one message to the group, in plain text with link previews turned off:

- the report for that month, under the title `<month name> <year>`, such as `September 2026`;
- then one empty line, the line `Top entries`, and up to 5 lines for the largest active entries of the month in categories that count as spending, written `<n>. <amount> · <category> · <description> · <date>`. The description, and its ` · `, SHALL be left out when it is empty, and shortened as in a confirmation when it is longer than 60 characters. Entries SHALL be ordered by amount, largest first, then by spent-on date, then by id. This block SHALL be left out when the month has no such entry;
- then one empty line, the line `Daily average: <amount>`, and the line `Days with entries: <n> of <days in the month>`.

The daily average SHALL be the spending total divided by the number of days in the month, rounded to a whole peso, with a half rounded up. The days with entries SHALL be the number of dates in the month that have at least one active entry.

When the month has no active entry at all, the message SHALL be the one line `🌱 Nothing logged in <month name> <year>.`

When the ledger cannot be read or the message cannot be sent, the run SHALL fail, so that the scheduler runs it again while it is due.

Rationale: the month is the unit a household budget is judged by, and the largest entries explain most of a month's total.

#### Scenario: Happy path — the recap of a month
- **GIVEN** September 2026 holds these active entries: ₱12,000 `rent` in `housing` dated 2026-09-01, ₱5,000 `cash in` in `transfer` dated 2026-09-15, ₱3,200 `meralco` in `bills` dated 2026-09-27, and four dated 2026-09-29: ₱2,340 `groceries gcash` in `groceries`, ₱250 `lunch` in `dining`, ₱180 `grab` in `transport` and ₱150 `acai` in `other`
- **WHEN** the tick of `2026-10-01T00:00:00Z` fires
- **THEN** chat `-1001` receives exactly one message:

```
📊 September 2026
₱18,120 · 6 entries

🏠 Housing · ₱12,000 · 66%
💡 Bills · ₱3,200 · 18%
🛒 Groceries · ₱2,340 · 13%
🍽 Dining · ₱250 · 1%
🚗 Transport · ₱180 · 1%
❓ Other · ₱150 · 1%

Not counted: 🔁 Transfers ₱5,000

Top entries
1. ₱12,000 · 🏠 Housing · rent · Sep 1
2. ₱3,200 · 💡 Bills · meralco · Sep 27
3. ₱2,340 · 🛒 Groceries · groceries gcash · Sep 29
4. ₱250 · 🍽 Dining · lunch · Sep 29
5. ₱180 · 🚗 Transport · grab · Sep 29

Daily average: ₱604
Days with entries: 4 of 30
```

#### Scenario: Failure — the ledger cannot be read
- **GIVEN** reading the ledger fails when the tick of `2026-10-01T00:00:00Z` fires
- **WHEN** the tick of `2026-10-01T01:00:00Z` fires and the ledger can be read
- **THEN** nothing was sent on the first tick, and the run record of `monthly_recap` for `2026-10-01` was `failed`
- **AND** the group receives the recap once, on the second tick

#### Scenario: Edge case — a month without entries
- **GIVEN** no active entry is dated in September 2026
- **WHEN** the tick of `2026-10-01T00:00:00Z` fires
- **THEN** the group receives the one line `🌱 Nothing logged in September 2026.`

#### Scenario: Edge case — the recap of December
- **GIVEN** December 2026 holds one entry of ₱310 in `dining`, with the description `noche buena`, dated 2026-12-24
- **WHEN** the tick of `2027-01-01T00:00:00Z` fires, which is 08:00 on 2027-01-01 in household time
- **THEN** the title is `December 2026`, the top entries are the one line `1. ₱310 · 🍽 Dining · noche buena · Dec 24`, and the last two lines are `Daily average: ₱10` and `Days with entries: 1 of 31`

#### Scenario: Edge case — a half peso is rounded up, and February is short
- **GIVEN** February 2027 holds one entry of ₱14 in `dining`
- **WHEN** the recap for February 2027 is sent
- **THEN** the last two lines are `Daily average: ₱1` and `Days with entries: 1 of 28`

#### Scenario: Edge case — only entries that are not counted
- **GIVEN** September 2026 holds one active entry, ₱5,000 in `transfer`
- **WHEN** the recap is sent
- **THEN** the message has no `Top entries` block, and its last two lines are `Daily average: ₱0` and `Days with entries: 1 of 30`

### Requirement: The system SHALL send each digest once per period

A digest or a recap SHALL be sent at most once for a scheduled date, even when the scheduler runs its job again for that date. Both jobs SHALL send through the scheduler's send record. A later scheduled date SHALL be sent on its own.

Rationale: the scheduler runs a job at least once per scheduled date, and a second summary of the same week would read as a mistake.

#### Scenario: Happy path — the job runs again for the same Sunday
- **GIVEN** the weekly digest for `2026-10-04` was sent
- **WHEN** `weekly_digest` runs again for `2026-10-04`
- **THEN** the group receives no second message

#### Scenario: Failure — the run's outcome was not saved
- **GIVEN** the monthly recap for `2026-10-01` was sent, and saving the run's outcome then failed, so that a later tick runs the job again
- **WHEN** `monthly_recap` runs again for `2026-10-01`
- **THEN** the group receives no second message, and the run ends without an error

#### Scenario: Edge case — the next period is sent
- **GIVEN** the weekly digest for `2026-10-04` was sent, and an entry is dated 2026-10-07
- **WHEN** the tick of `2026-10-11T11:00:00Z` fires, which is 19:00 on Sunday 2026-10-11 in household time
- **THEN** the group receives one more digest, with the title `Weekly digest · Oct 5 to Oct 11`

### Requirement: The system SHALL catch up a late digest for a day or two

The job `weekly_digest` SHALL be registered with a catch-up window of 24 hours, and the job `monthly_recap` with a catch-up window of 48 hours, as the `job-scheduler` requirement "The system SHALL give each job its own catch-up window" defines. A run inside the window SHALL cover the period of its scheduled date, as any run does.

Rationale: a digest that is a day late, or a recap that is two days late, is still worth reading. With the scheduler's 3-hour default, an outage of a few hours on a Sunday evening lost the week's digest for good.

#### Scenario: Happy path — a digest a day late
- **GIVEN** one entry is dated 2026-10-04, and no tick fired from Sunday 2026-10-04 19:00 until Monday 19:00
- **WHEN** the tick of `2026-10-05T11:00:00Z`, Monday 19:00 household time, fires
- **THEN** the group receives the weekly digest for Sep 28 to Oct 4

#### Scenario: Failure — a digest more than a day late
- **GIVEN** no tick fired from Sunday 2026-10-04 19:00 until Monday 20:00
- **WHEN** the tick of `2026-10-05T12:00:00Z` fires
- **THEN** the group receives nothing, and the run record of `weekly_digest` for `2026-10-04` is `skipped`

#### Scenario: Happy path — a recap two days late
- **GIVEN** one entry is dated 2026-09-29, and no tick fired from 2026-10-01 08:00 until 2026-10-03 08:00
- **WHEN** the tick of `2026-10-03T00:00:00Z` fires
- **THEN** the group receives the monthly recap for September 2026

#### Scenario: Failure — a recap more than two days late
- **GIVEN** no tick fired from 2026-10-01 08:00 until 2026-10-03 09:00
- **WHEN** the tick of `2026-10-03T01:00:00Z` fires
- **THEN** the group receives nothing, and the run record of `monthly_recap` for `2026-10-01` is `skipped`

#### Scenario: Edge case — one tick catches up both
- **GIVEN** an entry dated 2027-02-10, and no tick fired from Sunday 2027-02-28 19:00 until Monday 2027-03-01 08:00
- **WHEN** the tick of `2027-03-01T00:00:00Z` fires
- **THEN** the group receives the recap for February 2027, and the weekly digest of Sunday Feb 28 as well
