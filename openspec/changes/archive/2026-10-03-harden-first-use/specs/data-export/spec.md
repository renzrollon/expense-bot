## ADDED Requirements

### Requirement: The system SHALL limit /export all to 1,500 entries

Before it builds the file for `/export all`, the bot SHALL count the active entries. When there are more than 1,500, it SHALL send no file and SHALL reply to the command with one message:

```
📄 <count> entries are more than one file holds (1500). Export one month at a time, such as /export <YYYY-MM>.
```

`<YYYY-MM>` is the current month in the household timezone. The limit SHALL apply to `all` only: an export of one month SHALL have no limit.

Rationale: reading and encoding a row costs CPU time, and the Workers Free plan allows about 10 ms for a request. About 2,000 rows took 9 ms when measured. A Worker that passes the limit is stopped, and the member would get no reply at all.

#### Scenario: Failure — more entries than one file holds
- **GIVEN** the ledger holds 1,501 active entries
- **WHEN** a member sends `/export all` on `2026-09-29`
- **THEN** no file is sent, and the reply is `📄 1501 entries are more than one file holds (1500). Export one month at a time, such as /export 2026-09.`

#### Scenario: Edge case — as many entries as one file holds
- **GIVEN** the ledger holds 1,500 active entries and one removed entry
- **WHEN** a member sends `/export all`
- **THEN** the reply is the file, with the caption `📄 All months · 1500 entries`

#### Scenario: Edge case — a month has no limit
- **GIVEN** 1,501 active entries are dated in September 2026
- **WHEN** a member sends `/export 2026-09`
- **THEN** the reply is the file, with the caption `📄 September 2026 · 1501 entries`

### Requirement: The system SHALL ask for a failure alert for the nightly backup

The job `nightly_backup` SHALL be registered with a failure alert, as the `job-scheduler` requirement "The system SHALL tell the group when a job that asks for it did not finish" defines. The alert goes to the household group, also when `BACKUP_CHAT_ID` names another chat. It also covers a backup that was skipped because no tick came in its window, once the job has run before.

Rationale: each backup file covers about two months, so a backup that keeps failing unseen ends in lost data. The backup chat may itself be the cause, so the alert does not go there.

#### Scenario: Failure — the backup chat is not valid
- **GIVEN** `BACKUP_CHAT_ID` is `ana`, so the backup of `2026-09-30` fails at 23:00, 00:00, 01:00 and 02:00
- **WHEN** the tick of 03:00 fires
- **THEN** the household group receives the alert for `nightly_backup` and `Sep 30 23:00`, and no document is sent

### Requirement: The restore procedure SHALL restore a lost database before the bot uses it

For a database that was lost, the documented procedure SHALL give its steps in this order: create the database and put its id in the configuration, create the tables, apply the restore SQL, check the result, store the allowed chat id, and only then deploy the Worker. The document SHALL say why: an entry logged into the empty database takes an id that the restore then replaces.

The repository SHALL ignore the files the procedure creates in it: the folder `backups/`, `restore.sql` and `before-restore*.sql`, at the top of the repository.

#### Scenario: Edge case — the order is documented, verified by review
- **WHEN** the section for a lost database in the restore document is read
- **THEN** the deploy is its last step that changes anything, after the restore SQL is applied and the allowed chat id is stored

#### Scenario: Edge case — the ledger files are not committed, verified by review
- **WHEN** `backups/backup-entries-2026-09-30.csv`, `restore.sql` and `before-restore.sql` exist at the top of the repository
- **THEN** `git status` does not list them

### Requirement: The system SHALL send the whole ledger each month, a part a night

On the nights of the 1st to the 28th of each month, a run of `nightly_backup` SHALL also send one part of the snapshot to the backup chat, after the learned keywords file and without a notification sound. Part *n* is sent on the night of day *n*. It SHALL hold every entry, removed entries included, whose id is from (*n* − 1) × 1000 + 1 to *n* × 1000, ordered by id, with the columns of the entries file. When the greatest id in the ledger is below (*n* − 1) × 1000 + 1, the night SHALL send no part.

| File name | Caption |
|---|---|
| `backup-snapshot-part-<n>-<scheduled date>.csv` | `🗄 Snapshot part <n> of <parts> · ids <first>–<last> · <date> · <count> entries` |

`<parts>` is the greatest id divided by 1000, rounded up. `<last>` is *n* × 1000 or the greatest id, whichever is smaller. The date is written as in the other captions, and the caption says `1 entry` when the count is 1. A part SHALL be sent at most once for a scheduled date, through the scheduler's send record with the part `snapshot`, so that a repeated run sends only the files it has not sent yet.

Rationale: an entries file covers about two months, so a restore needed the last file of every month back to the start of the ledger, and a missing month, or an auto-delete timer on the chat, lost entries for good. Entries are never deleted, so the ids from 1 to the greatest id are the whole ledger, and one month's parts hold all of it. A restore then needs each part's newest file, followed by the newest entries and keywords files: the entries file holds every change since the first day of the month before, which is never later than when any part's newest copy was made. One file of every entry would pass the Workers Free plan's CPU limit, as `/export all` would; a part of 1,000 entries costs about 4.4 ms. Twenty-eight nights cover 28,000 entries.

#### Scenario: Happy path — part 1 on the 1st
- **GIVEN** the ledger holds entries 1, 2 and 3: entry 1 dated and stored in January 2025, entry 2 removed
- **WHEN** the tick of `2026-10-01T15:00:00Z` fires
- **THEN** the backup chat receives `backup-entries-2026-10-01.csv`, `backup-keywords-2026-10-01.csv` and `backup-snapshot-part-1-2026-10-01.csv`, in that order
- **AND** the snapshot's caption is `🗄 Snapshot part 1 of 1 · ids 1–3 · Oct 1 · 3 entries`, it is sent without a notification sound, and it holds the header of the entries file and the rows of entries 1, 2 and 3

#### Scenario: Happy path — part 2 on the 2nd
- **GIVEN** the ledger holds entries 1, 1001 and 1500
- **WHEN** the tick of `2026-10-02T15:00:00Z` fires
- **THEN** the snapshot is `backup-snapshot-part-2-2026-10-02.csv` with the caption `🗄 Snapshot part 2 of 2 · ids 1001–1500 · Oct 2 · 2 entries`, holding entries 1001 and 1500

#### Scenario: Edge case — the ledger ends before the part
- **GIVEN** the greatest id is 3
- **WHEN** the tick of `2026-10-02T15:00:00Z` fires
- **THEN** the backup chat receives the entries file and the keywords file and no snapshot

#### Scenario: Edge case — after night 28
- **GIVEN** the greatest id is 28500
- **WHEN** the tick of `2026-10-29T15:00:00Z` fires
- **THEN** the backup chat receives the entries file and the keywords file and no snapshot

#### Scenario: Failure — a repeated run sends only what is left
- **GIVEN** the entries file and the keywords file of `2026-10-01` were sent, and the run stopped before the snapshot
- **WHEN** `nightly_backup` runs again for `2026-10-01`
- **THEN** the backup chat receives only `backup-snapshot-part-1-2026-10-01.csv`, and the run record is `done`

## MODIFIED Requirements

### Requirement: The system SHALL send a nightly backup at 23:00

The bot SHALL register a job named `nightly_backup` that runs daily at 23:00 household time. A run SHALL send two documents to the backup chat, each without a notification sound, the entries file first. On the 1st to the 28th of a month it SHALL then send one part of the monthly snapshot, as "The system SHALL send the whole ledger each month, a part a night" defines.

| File | File name | Caption |
|---|---|---|
| entries | `backup-entries-<scheduled date>.csv` | `🗄 Backup · <date> · <count> entries` |
| learned keywords | `backup-keywords-<scheduled date>.csv` | `🗄 Learned keywords · <date> · <count> keywords` |

The date in a caption SHALL be the scheduled date, written as the short English month and the day. A caption SHALL say `1 entry` or `1 keyword` when the count is 1.

The **entries file** SHALL hold every entry, removed entries included, that is dated on or after the first day of the month before the scheduled date's month. It SHALL also hold every older-dated entry that was stored or last changed at or after 00:00 UTC of that first day. Rows SHALL be ordered by id. Its columns SHALL be the columns of an export file, followed by `chat_id`, `source_message_id`, `item_index`, `confirmation_message_id`, `payer_user_id`, `category_source`, `parser`, `check_amount`, `created_by`, `updated_at`, `updated_by`, `deleted_by` and `source_edited_at`, each as stored. The amount check SHALL be written as `1` or `0`.

The **learned keywords file** SHALL hold every learned keyword, ordered by keyword, with the columns `keyword`, `category_id`, `source`, `taught_by`, `hit_count`, `created_at` and `updated_at`.

A file with no rows SHALL still be sent, with its header row. Each file SHALL be sent at most once for a scheduled date, through the scheduler's send record. When a file cannot be sent, the run SHALL fail, so that the scheduler runs it again while it is due.

Rationale: a copy that lands on both phones every night covers the loss of the database. The extra columns make a restore exact, and the older changed entries keep the nightly files, taken together, complete.

#### Scenario: Happy path — a night's backup
- **GIVEN** the ledger holds entry 7 and nothing else, and the learned keywords hold `acai` for `dining`
- **WHEN** the tick of `2026-09-30T15:00:00Z` fires
- **THEN** chat `-1001` receives two documents, each sent without a notification sound: `backup-entries-2026-09-30.csv` with the caption `🗄 Backup · Sep 30 · 1 entry`, then `backup-keywords-2026-09-30.csv` with the caption `🗄 Learned keywords · Sep 30 · 1 keyword`
- **AND** the entries file holds the header row and the row `7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250,'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,`

#### Scenario: Failure — the second file cannot be sent
- **GIVEN** sending the keywords file fails when the tick of `2026-09-30T15:00:00Z` fires
- **WHEN** the tick of `2026-09-30T16:00:00Z` fires and sending works again
- **THEN** the run record of `nightly_backup` for `2026-09-30` was `failed` after the first tick and is `done` after the second
- **AND** the chat has received the entries file once and the keywords file once

#### Scenario: Edge case — removed entries and older changed entries
- **GIVEN** an entry dated 2026-08-01, a removed entry dated 2026-09-10, an entry dated 2026-06-10 whose category was changed on 2026-09-20, and an entry dated 2026-07-31 that was last changed on 2026-07-31
- **WHEN** the backup for `2026-09-30` is sent
- **THEN** the entries file holds the first three, the removed one with its removal time, and does not hold the entry dated 2026-07-31

#### Scenario: Edge case — nothing to back up
- **GIVEN** the ledger and the learned keywords are empty
- **WHEN** the tick of `2026-09-30T15:00:00Z` fires
- **THEN** the chat receives both files, each holding its header row only, with the captions `🗄 Backup · Sep 30 · 0 entries` and `🗄 Learned keywords · Sep 30 · 0 keywords`

#### Scenario: Edge case — the window in January
- **WHEN** the backup for `2027-01-15` is built
- **THEN** it holds every entry dated on or after 2026-12-01
