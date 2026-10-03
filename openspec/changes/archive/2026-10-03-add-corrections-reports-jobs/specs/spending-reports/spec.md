## Purpose

Spending reports turn the ledger into household totals for a period: how much was spent, on how many entries, and in which categories. Members ask for a report with `/today`, `/week` or `/month`, and the scheduled digests are built from the same report.

## ADDED Requirements

In every scenario of this specification, unless the scenario says otherwise:

- the household timezone is `Asia/Manila`, and a command is handled at 10:00 on Tuesday 2026-09-29, so the current week runs from Monday 2026-09-28 to Sunday 2026-10-04;
- the category list is the default list, in which only `transfer` does not count as spending;
- **the example week** holds 23 active entries dated 2026-09-28 or 2026-09-29 that count as spending: ₱3,200 in `groceries`, ₱2,150 in `dining`, ₱1,300 in `transport`, ₱1,100 in `bills` and ₱700 in `other`. It also holds one active entry of ₱2,000 in `transfer`.

### Requirement: The system SHALL total a period by category

A report SHALL cover a period of two local dates, both included, and SHALL be built from the active entries whose spent-on date falls in the period, whoever paid. It SHALL hold:

- the **spending total**: the sum of the entries in categories that count as spending. An entry whose category id is not in the category list SHALL count as spending.
- the **entry count**: the number of entries in the spending total.
- one **category line** for each category that counts as spending and has an entry, with the category's total and its **share** of the spending total. Lines SHALL be ordered by total, largest first, and lines with equal totals by category id.
- one **not-counted line** for each category that does not count as spending and has an entry, with its total. These entries SHALL be left out of the spending total, the entry count and the shares.

A share SHALL be a whole percentage, rounded to the nearest whole number, with a half rounded up. The shares need not add up to 100. All sums SHALL be computed in whole centavos. A report SHALL hold household totals only, with no figure for a single member. A period whose dates are not written as `YYYY-MM-DD` SHALL be rejected.

Rationale: one report builder serves both the commands and the scheduled digests, so both show the same numbers.

#### Scenario: Happy path — totals, order and shares
- **GIVEN** the example week
- **WHEN** a report is built for 2026-09-28 to 2026-09-29
- **THEN** the spending total is ₱8,450 and the entry count is 23
- **AND** the category lines are, in order: `groceries` ₱3,200 with 38%, `dining` ₱2,150 with 25%, `transport` ₱1,300 with 15%, `bills` ₱1,100 with 13%, and `other` ₱700 with 8%
- **AND** the one not-counted line is `transfer` with ₱2,000

#### Scenario: Failure — a malformed period is rejected
- **WHEN** a report is requested for `2026/09/28` to `2026-09-29`
- **THEN** the request is rejected, and no report is built

#### Scenario: Edge case — a removed entry counts nowhere
- **GIVEN** the example week, in which the ₱700 entry in `other` was removed
- **WHEN** the report is built
- **THEN** the spending total is ₱7,750, the entry count is 22, and there is no line for `other`

#### Scenario: Edge case — an entry counts on its spent-on date
- **GIVEN** Ana typed `kahapon lunch 250` on 2026-09-29
- **WHEN** a report is built for the single day 2026-09-28, and another for the single day 2026-09-29
- **THEN** the entry counts in the report for 2026-09-28, and not in the report for 2026-09-29

#### Scenario: Edge case — a category that is no longer in the list
- **GIVEN** the period holds one entry of ₱500 with the category id `snacks`, which is not in the category list
- **WHEN** the report is built
- **THEN** the entry counts in the spending total, and the report has a category line for the id `snacks`

#### Scenario: Edge case — a half is rounded up
- **GIVEN** the period holds ₱875 in `groceries` and ₱125 in `dining`
- **WHEN** the report is built
- **THEN** the shares are 88% and 13%

### Requirement: The system SHALL write a report as plain text

A report SHALL be written as plain text, with no formatting markup, under a title:

```
📊 <title>
<spending total> · <entry count> entries

<category> · <total> · <share>
…

Not counted: <category> <total>
```

- The second line SHALL say `1 entry` when the entry count is 1.
- Amounts SHALL be written as in a confirmation, such as `₱3,200` and `₱1,500.50`.
- A category SHALL be written as its emoji, a space and its short name. A category id that is not in the category list SHALL be written as the id alone.
- A share SHALL be written as the number and `%`. A share that rounds to 0 SHALL be written as `<1%`.
- The category lines SHALL follow one empty line. When the report has no category line, that empty line and the lines SHALL be left out.
- The not-counted lines SHALL be written on one line, after one empty line, as `Not counted: ` and each category with its total, separated by `, `. When nothing is not counted, the empty line and this line SHALL be left out.
- When the period has no active entry at all, the whole text SHALL be the one line `📊 <title> · no entries`.

#### Scenario: Happy path — a full report
- **GIVEN** the example week
- **WHEN** the report for 2026-09-28 to 2026-09-29 is written under the title `This week · Sep 28 to Sep 29`
- **THEN** the text is exactly:

```
📊 This week · Sep 28 to Sep 29
₱8,450 · 23 entries

🛒 Groceries · ₱3,200 · 38%
🍽 Dining · ₱2,150 · 25%
🚗 Transport · ₱1,300 · 15%
💡 Bills · ₱1,100 · 13%
❓ Other · ₱700 · 8%

Not counted: 🔁 Transfers ₱2,000
```

#### Scenario: Failure — the period has no entries
- **GIVEN** no active entry is dated 2026-09-29
- **WHEN** the report for that day is written under the title `Today · Sep 29`
- **THEN** the text is the one line `📊 Today · Sep 29 · no entries`

#### Scenario: Edge case — only entries that are not counted
- **GIVEN** the only active entry dated 2026-09-29 is ₱2,000 in `transfer`
- **WHEN** the report for that day is written under the title `Today · Sep 29`
- **THEN** the text is exactly:

```
📊 Today · Sep 29
₱0 · 0 entries

Not counted: 🔁 Transfers ₱2,000
```

#### Scenario: Edge case — one entry, with centavos
- **GIVEN** the only active entry dated 2026-09-29 is ₱1,500.50 in `groceries`
- **WHEN** the report for that day is written under the title `Today · Sep 29`
- **THEN** the text is exactly:

```
📊 Today · Sep 29
₱1,500.50 · 1 entry

🛒 Groceries · ₱1,500.50 · 100%
```

#### Scenario: Edge case — a very small share and an unknown category
- **GIVEN** the period holds ₱8,440 in `groceries` and ₱10 in `snacks`, which is not in the category list
- **WHEN** the report is written
- **THEN** the category lines are `🛒 Groceries · ₱8,440 · 100%` and `snacks · ₱10 · <1%`

### Requirement: The system SHALL answer /today, /week and /month with a report

The bot SHALL provide three commands. Each SHALL answer with exactly one message, sent as a reply to the command, with link previews turned off: the report for its period under its title.

| Command | Description in `/help` | Period | Title |
|---|---|---|---|
| `/today` | `spending today` | today | `Today · <date>` |
| `/week` | `spending this week` | Monday of this week to today | `This week · <range>` |
| `/month` | `spending this month` | the 1st of this month to today | `This month · <range>` |

Today SHALL be the local date in the household timezone at the time the command is handled. A week SHALL run from Monday to Sunday. A date SHALL be written as the short English month and the day, such as `Sep 28`. A range SHALL be written as `<first date> to <last date>`, or as the one date when both are the same. Text after the command SHALL be ignored.

When the ledger cannot be read, the bot SHALL send no reply and the attempt SHALL fail, so that the gateway runs the command again.

Rationale: totals are the payoff for logging, and a command makes the report available on demand.

#### Scenario: Happy path — /week
- **GIVEN** the example week
- **WHEN** Ana sends `/week`
- **THEN** the bot replies once, to the command, with the full report of the scenario "Happy path — a full report", under the title `This week · Sep 28 to Sep 29`

#### Scenario: Happy path — /today and /month
- **GIVEN** the example week, in which ₱250 in `dining` is the only entry dated 2026-09-29, and September holds no entry before 2026-09-28
- **WHEN** Ana sends `/today` and then `/month`
- **THEN** the first reply starts with `📊 Today · Sep 29` and `₱250 · 1 entry`
- **AND** the second reply starts with `📊 This month · Sep 1 to Sep 29` and `₱8,450 · 23 entries`

#### Scenario: Failure — the ledger cannot be read
- **GIVEN** reading the ledger fails
- **WHEN** Ana sends `/week`
- **THEN** the bot sends no reply, and the update is recorded as failed, to be run again
- **AND** when Telegram delivers the command again and the ledger can be read, the bot replies once

#### Scenario: Edge case — the commands are listed in /help
- **WHEN** a member sends `/help` to the bot as it is deployed
- **THEN** the reply holds the lines `/today · spending today`, `/week · spending this week` and `/month · spending this month`

#### Scenario: Edge case — Monday, and the first of the month
- **GIVEN** a command is handled on Monday 2026-09-28, and another on Thursday 2026-10-01
- **WHEN** `/week` is sent on the Monday, and `/month` on the 1st
- **THEN** the titles are `This week · Sep 28` and `This month · Oct 1`

#### Scenario: Edge case — the local date differs from the UTC date
- **GIVEN** a command is handled at `2026-09-29T16:30:00Z`, which is 00:30 on Wednesday 2026-09-30 in Manila
- **WHEN** Ana sends `/today`
- **THEN** the title is `Today · Sep 30`, and the report covers the entries dated 2026-09-30

#### Scenario: Edge case — text after the command
- **WHEN** Ana sends `/week please`
- **THEN** the reply is the same as for `/week`
