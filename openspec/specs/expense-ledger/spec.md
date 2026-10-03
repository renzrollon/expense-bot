## Purpose

The expense ledger is the household's one durable record of expenses. Capture writes entries into it, corrections change them, and reports, the nudge and the export read them. Every other feature goes through it rather than the table.

## Requirements

### Requirement: Entry record
The ledger SHALL store one entry per expense item. Each entry SHALL hold:

- an id: a positive whole number the ledger assigns, unique in the ledger;
- the chat id and the source message id of the message the item came from;
- the item index: the item's position in that message, from 0;
- the confirmation message id, which is absent until one is attached;
- the payer's user id;
- the amount in whole centavos, and the currency `PHP`;
- the description, which MAY be empty;
- the category id, and the category source: one of `keyword`, `learned`, `llm`, `manual` or `default`;
- the spent-on date, as `YYYY-MM-DD`, a local calendar date in the household timezone;
- the raw text of the whole message;
- the parser: `rules` or `llm`;
- whether the amount needs checking;
- the time the entry was created and the user id of who created it;
- the time it was last changed and the user id of who changed it;
- the time it was removed and the user id of who removed it, both absent while the entry is active.

Times SHALL be UTC, written as ISO-8601 with milliseconds and taken from the time the caller passes in. The ledger SHALL NOT check the category id against the category list. It SHALL accept any id that is not empty. The caller validates it.

An entry is **active** while it has no removal time.

In every scenario of this specification, unless the scenario says otherwise, the time passed in is `2026-09-29T10:00:00.000Z`, the chat id is `-1001`, the members are Ana (user id 1001) and Ben (user id 1002), and each write is made by the payer.

#### Scenario: A stored entry holds every field
- **WHEN** Ana's message 10, `lunch 250`, is stored as one item with the amount 25000, the description `lunch`, the category `dining` from source `keyword`, the spent-on date `2026-09-29`, the parser `rules`, and an amount that needs no check
- **THEN** the entry has a new id, chat id `-1001`, source message id 10, item index 0, no confirmation message id, payer 1001, amount 25000, currency `PHP`, description `lunch`, category `dining`, source `keyword`, spent-on `2026-09-29`, raw text `lunch 250`, parser `rules`, and no amount check
- **AND** it was created and last changed at `2026-09-29T10:00:00.000Z` by 1001, and it has no removal time and no remover

### Requirement: A message's items are stored together, once
The ledger SHALL store all items of one message in a single write that stores either every item or none of them. A write SHALL hold at least 1 and at most 10 items. Each item SHALL become one entry, with the item index equal to its position in the write.

A message SHALL be identified by its chat id and its source message id together. When the ledger already holds entries for the message, the write SHALL store nothing. It SHALL return the stored entries unchanged, in item order, and report that nothing was created. This SHALL hold whatever items the repeated write carries, and whether or not the stored entries were removed since.

A successful first write SHALL return the new entries in item order and report that they were created. The ledger SHALL never hold two entries with the same chat id, source message id and item index. A write that races another write for the same message MAY fail and store nothing. A later write for that message then returns the stored entries.

#### Scenario: Two items from one message
- **WHEN** Ana's message 11, `grab 180, groceries 2340 gcash`, is stored with the items ₱180 `grab` in `transport` and ₱2,340 `groceries gcash` in `groceries`
- **THEN** the write reports that entries were created
- **AND** the ledger holds two entries for message 11, with item indexes 0 and 1, and the same raw text

#### Scenario: The same message is stored twice
- **WHEN** message 10 is stored, and the same write is made again 5 seconds later
- **THEN** the ledger holds one set of entries for message 10
- **AND** the second write reports that nothing was created and returns the entries of the first write, with their first creation time

#### Scenario: A repeated write with different items changes nothing
- **WHEN** message 10 was stored with one item, and a second write for message 10 carries two items with other amounts
- **THEN** the ledger still holds only the first write's one entry for message 10, unchanged
- **AND** the second write returns that entry and reports that nothing was created

#### Scenario: A removed entry is not stored again
- **WHEN** the one entry of message 10 was removed, and message 10 is written again
- **THEN** nothing is stored, and the write returns the removed entry

#### Scenario: The same message id in another chat is another message
- **WHEN** message 10 of chat `-1001` is stored, then message 10 of chat `-1002` is stored
- **THEN** the ledger holds one entry for each chat

#### Scenario: One item fails to store
- **WHEN** a message with two items is written, and the database fails while it stores the second item
- **THEN** the write fails, and the ledger holds no entry for that message
- **AND** the same write made again afterwards stores both items

### Requirement: Invalid writes are rejected
The ledger SHALL reject a write, and store nothing, when any of these holds:

- it has no items, or more than 10;
- an amount is not a whole number, or is less than 1 or more than 999,999,999 centavos;
- a spent-on date is not written as `YYYY-MM-DD`;
- a category id is empty;
- a category source or the parser is not one of the allowed values.

The ledger SHALL reject the write as invalid input before it sends anything to the database, so a rejection never depends on the database. The stored table SHALL also refuse an entry whose amount is not a whole number from 1 to 999,999,999, whose category source or parser is not one of the allowed values, or which has a removal time without a remover.

#### Scenario: Amounts that are rejected
- **WHEN** a write carries an item with the amount 0, -100, 250.5 or 1,000,000,000
- **THEN** the write is rejected, and the ledger holds no entry for that message

#### Scenario: Amounts at the limits are stored
- **WHEN** a write carries the amounts 1 and 999,999,999
- **THEN** both entries are stored

#### Scenario: Too many or too few items
- **WHEN** a write carries 11 items, or none
- **THEN** the write is rejected, and nothing is stored

#### Scenario: A date, a category or a source that is not valid
- **WHEN** a write carries the spent-on date `29/09/2026`, or an empty category id, or the category source `guess`, or the parser `magic`
- **THEN** the write is rejected, and nothing is stored

#### Scenario: An invalid write never reaches the database
- **WHEN** an invalid write is made while every database statement would fail
- **THEN** the write is rejected as invalid input, not as a database failure

#### Scenario: The table refuses invalid entries written directly
- **WHEN** an entry is inserted into the table without going through the ledger, with the amount 0, or the category source `guess`, or the parser `magic`, or a removal time and no remover, or the same chat id, source message id and item index as a stored entry
- **THEN** the database refuses it

### Requirement: Confirmation message id
The ledger SHALL attach a confirmation message id to every entry of a message that has none. An entry that already has one SHALL keep it. Attaching SHALL NOT change the time of the last change or who made it.

#### Scenario: Attach a confirmation
- **WHEN** message 11 has two entries and the confirmation message id 900 is attached
- **THEN** both entries have the confirmation message id 900, and their last-change time and changer are unchanged

#### Scenario: A second confirmation id is ignored
- **WHEN** the confirmation message id 900 was attached to message 11, and 901 is attached afterwards
- **THEN** both entries keep 900

### Requirement: Entries of a source message
The ledger SHALL return every entry of a message, given its chat id and source message id, in item order, including removed entries. A message with no entries SHALL give an empty list.

#### Scenario: Find the entries of a message
- **WHEN** message 11 has two entries and the second was removed
- **THEN** looking up message 11 returns both entries in item order, the second with its removal time

#### Scenario: A message with no entries
- **WHEN** message 99 was never stored
- **THEN** looking it up returns an empty list

### Requirement: Soft delete
Removing an entry SHALL set its removal time and remover, and SHALL also record them as the time of the last change and who made it. The entry SHALL stay in the ledger. The ledger SHALL NOT offer any way to erase an entry. Removing an entry that is already removed SHALL change nothing and report that nothing changed. Removing an entry id the ledger does not hold SHALL report that it was not found.

#### Scenario: Remove an entry
- **WHEN** Ben removes Ana's entry at `2026-09-29T11:00:00.000Z`
- **THEN** the result reports a change and returns the entry with the removal time `2026-09-29T11:00:00.000Z` and the remover 1002
- **AND** its last change is the same time by 1002, and every other field is unchanged

#### Scenario: Remove twice
- **WHEN** an entry is removed, and then removed again by someone else
- **THEN** the second result reports no change, and the entry keeps the first removal time and remover

#### Scenario: Remove an unknown entry
- **WHEN** entry id 424242 is removed and the ledger holds no such entry
- **THEN** the result reports that it was not found

### Requirement: Restore
Restoring a removed entry SHALL clear its removal time and remover, and SHALL record the time of the last change and who made it. Every other field SHALL keep the value it had before it was removed. Restoring an active entry SHALL change nothing and report that nothing changed. Restoring an unknown entry id SHALL report that it was not found.

#### Scenario: Restore brings the entry back unchanged
- **WHEN** an entry is removed and then restored by Ana
- **THEN** the entry is active again, with the same amount, description, category, category source, spent-on date and confirmation message id as before it was removed
- **AND** its last change is the time of the restore, by 1001

#### Scenario: Restore an active entry
- **WHEN** an entry that was never removed is restored
- **THEN** the result reports no change, and the entry is unchanged

#### Scenario: Restore an unknown entry
- **WHEN** entry id 424242 is restored and the ledger holds no such entry
- **THEN** the result reports that it was not found

### Requirement: Set category
Setting the category of an active entry SHALL store the new category id and category source, and SHALL record the time of the last change and who made it. When the entry already has that category id and that source, nothing SHALL change and the result SHALL report no change. A removed entry SHALL NOT change, and the result SHALL report no change. An unknown entry id SHALL be reported as not found.

#### Scenario: Change the category
- **WHEN** Ben sets the category of an entry filed under `other` from source `default` to `dining` from source `manual`
- **THEN** the result reports a change, and the entry has the category `dining`, the source `manual`, and its last change by 1002

#### Scenario: The same category again
- **WHEN** an entry has the category `dining` from source `manual`, and it is set to `dining` from source `manual` again
- **THEN** the result reports no change, and the entry is unchanged

#### Scenario: A removed entry keeps its category
- **WHEN** the category of a removed entry is set
- **THEN** the result reports no change, and the entry is unchanged

#### Scenario: Set the category of an unknown entry
- **WHEN** the category of entry id 424242 is set and the ledger holds no such entry
- **THEN** the result reports that it was not found

### Requirement: Latest active entry of a member
The ledger SHALL return the active entry whose payer is the given member and that was created last. When two entries were created at the same time, the one with the higher id SHALL be returned. The search SHALL cover the whole ledger, whatever chat an entry came from. A member with no active entry SHALL get no entry.

#### Scenario: The latest entry of a member
- **WHEN** Ana stored message 10 at 10:00 and message 11, with two items, at 10:05, and Ben stored message 12 at 10:10
- **THEN** Ana's latest active entry is item 1 of message 11

#### Scenario: Removed entries are skipped
- **WHEN** Ana's latest entry is removed
- **THEN** her latest active entry is the one created before it

#### Scenario: A backdated entry typed last is the latest
- **WHEN** Ana stored `lunch 250` dated today at 10:00, then `kahapon dinner 400` dated yesterday at 10:05
- **THEN** her latest active entry is the dinner

#### Scenario: An entry from another chat can be the latest
- **WHEN** Ana stored an entry from chat `-1001` at 10:00, and another from chat `-1002` at 10:05 after the group became a supergroup
- **THEN** her latest active entry is the one from chat `-1002`

#### Scenario: No active entries
- **WHEN** every entry of Ana's is removed, or she has none
- **THEN** no entry is returned

### Requirement: Totals by category
Given a period of two `YYYY-MM-DD` dates, the ledger SHALL total the active entries whose spent-on date falls within the period, both end dates included. It SHALL return one row per stored category id, with the sum of the amounts in centavos and the number of entries. Rows SHALL be ordered by sum, largest first, and rows with equal sums by category id. A category id that is not in the category list SHALL be totaled under its stored id. Entries SHALL be selected by spent-on date, not by creation time, and from the whole ledger, whatever chat they came from. A period with no active entries SHALL give no rows. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

#### Scenario: Both end dates are included
- **WHEN** entries are dated `2026-09-27`, `2026-09-28`, `2026-10-04` and `2026-10-05`, and the period is `2026-09-28` to `2026-10-04`
- **THEN** the totals cover the entries dated `2026-09-28` and `2026-10-04` only

#### Scenario: Per-category sums and counts
- **WHEN** the period holds ₱250 and ₱150 in `dining` and ₱2,340 in `groceries`
- **THEN** the totals are `groceries` with 234000 centavos and 1 entry, then `dining` with 40000 centavos and 2 entries

#### Scenario: Removed entries are left out, and restored ones count again
- **WHEN** one of two `dining` entries in the period is removed
- **THEN** the `dining` total covers only the other entry
- **AND** when it is restored, the `dining` total covers both again

#### Scenario: Selected by spent-on date
- **WHEN** an entry created on `2026-09-29` has the spent-on date `2026-09-28`, and the period is the single day `2026-09-28`
- **THEN** the entry counts toward that day

#### Scenario: An unknown category id still counts
- **WHEN** an entry in the period has the category id `snacks`, which is not in the category list
- **THEN** the totals hold a row for `snacks`

#### Scenario: Entries from before a supergroup migration still count
- **WHEN** one entry in the period came from chat `-1001`, and another came from chat `-1002` after the group became a supergroup
- **THEN** the totals cover both

#### Scenario: An empty period
- **WHEN** no active entry falls within the period
- **THEN** the totals have no rows

#### Scenario: A malformed period date is rejected
- **WHEN** totals are requested from `2026/09/28` to `2026-10-04`
- **THEN** the request is rejected

### Requirement: Entries in a period
Given a period of two `YYYY-MM-DD` dates, both included, the ledger SHALL list the entries whose spent-on date falls within the period, ordered by spent-on date and then by id. By default the list SHALL hold only active entries. When the caller asks for removed entries too, it SHALL hold both. The list SHALL come from the whole ledger, whatever chat an entry came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

#### Scenario: Active entries only
- **WHEN** a period holds three entries and one of them is removed
- **THEN** the list holds the two active entries, ordered by spent-on date and then by id

#### Scenario: With removed entries
- **WHEN** the same period is listed with removed entries included
- **THEN** the list holds all three, and the removed one has its removal time

#### Scenario: A backdated entry lists by its date
- **WHEN** an entry dated `2026-09-29` is stored first, and an entry dated `2026-09-28` is stored after it
- **THEN** the list for `2026-09-28` to `2026-09-29` holds the `2026-09-28` entry first

#### Scenario: Entries from every chat are listed
- **WHEN** the period holds one entry from chat `-1001` and one from chat `-1002`
- **THEN** the list holds both

#### Scenario: A malformed list date is rejected
- **WHEN** the entries from `2026-09-28` to `2026-10-4` are listed
- **THEN** the request is rejected

### Requirement: Count of active entries for a date
The ledger SHALL count the active entries whose spent-on date is a given `YYYY-MM-DD` date, from the whole ledger, whatever chat an entry came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

#### Scenario: Count for a date
- **WHEN** `2026-09-29` has three entries and one of them is removed, and `2026-09-28` has one entry
- **THEN** the count for `2026-09-29` is 2

#### Scenario: Only removed entries
- **WHEN** every entry dated `2026-09-29` is removed
- **THEN** the count for `2026-09-29` is 0

#### Scenario: Entries from every chat are counted
- **WHEN** `2026-09-29` has one active entry from chat `-1001` and one from chat `-1002`
- **THEN** the count for `2026-09-29` is 2

#### Scenario: A malformed count date is rejected
- **WHEN** the count for `29 Sep 2026` is requested
- **THEN** the request is rejected

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

### Requirement: Active entries in a period

Given a period of two `YYYY-MM-DD` dates, both included, the ledger SHALL return the number of active entries whose spent-on date is in the period, from the whole ledger, whatever chat an entry came from. A date that is not written as `YYYY-MM-DD` SHALL be rejected.

Rationale: `/export all` checks the size of the ledger before it reads it.

#### Scenario: Happy path — entries inside the period, both end dates included
- **GIVEN** active entries dated `2026-08-31`, `2026-09-01`, `2026-09-30` and `2026-10-01`
- **WHEN** the active entries from `2026-09-01` to `2026-09-30` are counted
- **THEN** the count is 2

#### Scenario: Failure — a malformed date is rejected
- **WHEN** the active entries from `2026-09-01` to `30 Sep 2026` are counted
- **THEN** the request is rejected

#### Scenario: Edge case — removed entries are not counted
- **GIVEN** one removed entry dated `2026-09-03` and one active entry dated `2026-09-10`
- **WHEN** the active entries in September 2026 are counted
- **THEN** the count is 1

#### Scenario: Edge case — an empty ledger
- **WHEN** the active entries are counted and the ledger holds none
- **THEN** the count is 0
