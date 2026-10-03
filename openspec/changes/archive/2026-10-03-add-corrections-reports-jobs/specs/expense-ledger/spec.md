## ADDED Requirements

### Requirement: Entry by id

The ledger SHALL return the entry that has a given id, whether it is active or removed. An id that the ledger does not hold SHALL give no entry. A value that is not a positive whole number SHALL also give no entry, and SHALL NOT fail.

Rationale: a correction button carries only an entry id, so corrections need to find an entry, and the message it belongs to, from the id alone.

#### Scenario: Happy path — find an entry by its id
- **GIVEN** Ana's message 10, `lunch 250`, is stored as entry 7
- **WHEN** entry 7 is looked up
- **THEN** the entry is returned with the source message id 10, the amount 25000 and every other stored field

#### Scenario: Failure — an unknown id
- **GIVEN** the ledger holds no entry 424242
- **WHEN** entry 424242 is looked up
- **THEN** no entry is returned

#### Scenario: Edge case — a removed entry is still found
- **GIVEN** entry 7 was removed by Ben
- **WHEN** entry 7 is looked up
- **THEN** the entry is returned with its removal time and the remover 1002

#### Scenario: Edge case — a value that is not an id
- **WHEN** the id `0`, `-1` or `1.5` is looked up
- **THEN** no entry is returned, and the lookup does not fail

### Requirement: Edit mark of a source message

The ledger SHALL record that a source message was edited after it was logged. Marking a message, given its chat id, its source message id and a time, SHALL set that time as the edit time on every entry of the message that has no edit time, removed entries included. An entry that already has an edit time SHALL keep it. Marking SHALL NOT change the time of an entry's last change or who made it, and SHALL NOT change any other field. Marking SHALL return the message's entries in item order. Marking a message that has no entries SHALL store nothing and return an empty list. Each entry SHALL expose its edit time, which is absent until the message is marked.

Rationale: the confirmation is built from the stored entries alone, so the fact that a message was edited has to be stored with them.

#### Scenario: Happy path — mark an edited message
- **GIVEN** message 11 has two entries, last changed at `2026-09-29T10:00:00.000Z` by 1001, and neither has an edit time
- **WHEN** message 11 is marked at `2026-09-29T11:00:00.000Z`
- **THEN** both entries have the edit time `2026-09-29T11:00:00.000Z`, and the mark returns both in item order
- **AND** their last change is still `2026-09-29T10:00:00.000Z` by 1001

#### Scenario: Failure — a message with no entries
- **GIVEN** message 99 was never stored
- **WHEN** message 99 is marked
- **THEN** nothing is stored, and the mark returns an empty list

#### Scenario: Edge case — a second mark keeps the first time
- **GIVEN** message 11 was marked at `2026-09-29T11:00:00.000Z`
- **WHEN** it is marked again at `2026-09-29T12:00:00.000Z`
- **THEN** both entries keep the edit time `2026-09-29T11:00:00.000Z`

#### Scenario: Edge case — a new entry has no edit time
- **WHEN** a message is stored
- **THEN** each of its entries has no edit time

### Requirement: Largest entries in a period

Given a period of two `YYYY-MM-DD` dates, both included, a limit, and a list of category ids to leave out, the ledger SHALL return the active entries in the period that have the largest amounts, at most as many as the limit. They SHALL be ordered by amount, largest first, then by spent-on date, earliest first, then by id. An entry whose category id is in the list to leave out SHALL NOT be returned. Entries SHALL be selected by spent-on date and from the whole ledger, whatever chat they came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected. A limit that is not a whole number from 1 to 50 SHALL be rejected.

Rationale: the monthly recap shows the 5 largest expenses, and a transfer is not an expense.

#### Scenario: Happy path — the two largest of three
- **GIVEN** September 2026 holds ₱12,000 `rent`, ₱3,200 `meralco` and ₱250 `lunch`
- **WHEN** the largest entries from `2026-09-01` to `2026-09-30` are requested with the limit 2 and nothing left out
- **THEN** the result is the ₱12,000 entry, then the ₱3,200 entry

#### Scenario: Failure — a malformed date or limit is rejected
- **WHEN** the largest entries are requested from `2026/09/01`, or with the limit 0, 51 or 2.5
- **THEN** the request is rejected

#### Scenario: Edge case — equal amounts
- **GIVEN** the period holds three entries of ₱500: entry 5 dated `2026-09-10`, entry 6 dated `2026-09-03`, and entry 7 dated `2026-09-03`
- **WHEN** the largest entries are requested with the limit 3
- **THEN** the order is entry 6, entry 7, entry 5

#### Scenario: Edge case — removed and left-out entries
- **GIVEN** the period holds a removed entry of ₱9,000, an entry of ₱20,000 in `transfer`, and an entry of ₱250 in `dining`
- **WHEN** the largest entries are requested with the limit 5, leaving out `transfer`
- **THEN** the result is the ₱250 entry alone

### Requirement: Days with entries in a period

Given a period of two `YYYY-MM-DD` dates, both included, the ledger SHALL return the number of different spent-on dates in the period that have at least one active entry, from the whole ledger, whatever chat an entry came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

Rationale: the monthly recap reports on how many days something was logged.

#### Scenario: Happy path — three entries on two days
- **GIVEN** two active entries dated `2026-09-03` and one dated `2026-09-10`
- **WHEN** the days with entries from `2026-09-01` to `2026-09-30` are counted
- **THEN** the count is 2

#### Scenario: Failure — a malformed date is rejected
- **WHEN** the days with entries from `2026-09-01` to `30 Sep 2026` are counted
- **THEN** the request is rejected

#### Scenario: Edge case — a day whose entries were all removed
- **GIVEN** the only entry dated `2026-09-03` was removed, and one active entry is dated `2026-09-10`
- **WHEN** the days with entries in September 2026 are counted
- **THEN** the count is 1

#### Scenario: Edge case — an empty period
- **WHEN** the days with entries are counted for a period that has no active entry
- **THEN** the count is 0

### Requirement: Entries for a backup window

Given a first date, written as `YYYY-MM-DD`, and a time, the ledger SHALL list every entry, removed entries included, that meets at least one of these conditions: its spent-on date is on or after the first date, or its last change is at or after the time. The list SHALL be ordered by id and SHALL hold each entry once. It SHALL come from the whole ledger, whatever chat an entry came from. A first date that is not written as `YYYY-MM-DD` SHALL be rejected.

Rationale: a backup that selects by spent-on date alone would miss an older-dated entry that was typed or corrected recently, and the nightly backups together would then no longer hold the whole ledger.

#### Scenario: Happy path — entries dated inside the window
- **GIVEN** entries dated `2026-07-31`, `2026-08-01` and `2026-09-15`, each last changed on the day it is dated
- **WHEN** the window from `2026-08-01` and `2026-08-01T00:00:00.000Z` is listed
- **THEN** the list holds the entries dated `2026-08-01` and `2026-09-15`, in id order

#### Scenario: Failure — a malformed first date is rejected
- **WHEN** the window from `1 Aug 2026` is listed
- **THEN** the request is rejected

#### Scenario: Edge case — an older entry that was changed inside the window
- **GIVEN** an entry dated `2026-06-10` whose category was changed at `2026-09-20T03:00:00.000Z`, and an entry dated `2026-06-11` that was never changed
- **WHEN** the window from `2026-08-01` and `2026-08-01T00:00:00.000Z` is listed
- **THEN** the list holds the entry dated `2026-06-10` and not the one dated `2026-06-11`

#### Scenario: Edge case — removed entries are listed, once
- **GIVEN** an entry dated `2026-09-15` that was removed at `2026-09-16T01:00:00.000Z`
- **WHEN** the window from `2026-08-01` and `2026-08-01T00:00:00.000Z` is listed
- **THEN** the list holds that entry exactly once, with its removal time

### Requirement: A member's removal at a given time

The ledger SHALL return the entry that a given member removed at a given time: the removed entry whose remover is that member and whose removal time is exactly that time. When several entries match, the one with the highest id SHALL be returned. When none matches, no entry SHALL be returned.

Rationale: `/undo` removes "the latest entry", which is a different entry on each run. A repeated run of the same command has to find the entry it already removed, and remove no other.

#### Scenario: Happy path — find the removal
- **GIVEN** Ana removed entry 7 at `2026-09-29T02:05:00.000Z`
- **WHEN** the entry that 1001 removed at `2026-09-29T02:05:00.000Z` is looked up
- **THEN** entry 7 is returned

#### Scenario: Failure — no removal matches
- **GIVEN** Ana removed entry 7 at `2026-09-29T02:05:00.000Z`
- **WHEN** the entry that 1002 removed at that time is looked up, or the entry that 1001 removed at `2026-09-29T02:05:01.000Z`
- **THEN** no entry is returned

#### Scenario: Edge case — a restored entry no longer matches
- **GIVEN** Ana removed entry 7 at `2026-09-29T02:05:00.000Z`, and Ben restored it afterwards
- **WHEN** the entry that 1001 removed at `2026-09-29T02:05:00.000Z` is looked up
- **THEN** no entry is returned
