## Purpose

Data export gives the household its ledger as files it owns. A member can ask for a CSV file of any month, the bot sends a backup to the chat every night, and a restore script turns backup files back into ledger rows, so the loss of the database does not lose the data.

## ADDED Requirements

In every scenario of this specification, unless the scenario says otherwise:

- the household timezone is `Asia/Manila`, the allowed chat id is `-1001`, and the members are Ana (user id 1001) and Ben (user id 1002);
- a command is handled at 10:00 on Tuesday 2026-09-29;
- **entry 7** is Ana's message 41 of chat `-1001`, `lunch 250`: ₱250, description `lunch`, category `dining` from source `keyword`, parser `rules`, spent-on date `2026-09-29`, created and last changed at `2026-09-29T02:00:03.000Z` by 1001, confirmed by message 900, active, with no amount check and no edit mark;
- the nightly job is run by the `job-scheduler`. The tick at `2026-09-30T15:00:00Z` is 23:00 on Wednesday 2026-09-30 in household time.

### Requirement: The system SHALL write CSV files in one format

Every CSV file the bot writes SHALL follow these rules:

- The file SHALL be UTF-8 text without a byte-order mark. Its first row SHALL hold the column names. Every row, the last one included, SHALL end with a carriage return and a line feed.
- Cells SHALL be separated by commas. A value that is absent SHALL be an empty cell.
- A cell that starts with `=`, `+`, `-`, `@` or `'` SHALL get one `'` in front of it, so that a spreadsheet shows it as text and does not run it as a formula. This SHALL apply to every cell of every column.
- A cell that holds a comma, a double quote, a carriage return or a line feed SHALL be put in double quotes, with each double quote inside it written twice. This SHALL be applied after the `'` is added.
- An amount SHALL be written in pesos with exactly two decimals, with no currency sign and no grouping, such as `250.00` and `1500.50`.
- Text typed by members SHALL otherwise be written exactly as stored.

Rationale: the file has to open with the right columns in any spreadsheet, and a description typed in the chat must never run as a formula on the phone that opens it.

#### Scenario: Happy path — a plain row
- **WHEN** entry 7 is written as a row of an export file
- **THEN** the row is `7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250`, followed by a carriage return and a line feed

#### Scenario: Failure — a cell that a spreadsheet would run as a formula
- **WHEN** a row is written whose description is `=SUM(A1:A9)`, `+63 load`, `-50 refund` or `@home`
- **THEN** the description cell is `'=SUM(A1:A9)`, `'+63 load`, `'-50 refund` or `'@home`

#### Scenario: Edge case — commas, quotes and line breaks
- **WHEN** a row is written whose description is `milk, eggs`, or `the "good" rice`, or whose raw text is `grab 180` and `groceries 2340` on two lines
- **THEN** the cells are `"milk, eggs"`, `"the ""good"" rice"`, and the two lines inside one pair of double quotes with the line break kept
- **AND** a parser that follows the same rules reads back the same number of columns and the same text

#### Scenario: Edge case — a cell that starts with an apostrophe
- **WHEN** a row is written whose description is `'til friday`
- **THEN** the description cell is `''til friday`, so that taking one `'` off the front gives back the stored text

#### Scenario: Edge case — a formula with a comma
- **WHEN** a row is written whose description is `=1,2`
- **THEN** the description cell is `"'=1,2"`

#### Scenario: Edge case — amounts and other scripts
- **WHEN** rows are written for the amounts ₱0.05 and ₱1,500.50, and for the description `piña 🍍`
- **THEN** the amount cells are `0.05` and `1500.50`, and the description cell is `piña 🍍`

### Requirement: The system SHALL export entries on /export

The bot SHALL provide the command `/export`, with the description `CSV file: /export, /export 2026-08, /export all`. The text after the command, with white space removed from both ends and letter case ignored, selects what is exported:

| Text | Entries | File name | Caption |
|---|---|---|---|
| none | dated in the current month | `expenses-<YYYY-MM>.csv` | `📄 <month name> <year> · <count> entries` |
| a month, as `YYYY-MM` | dated in that month | `expenses-<YYYY-MM>.csv` | `📄 <month name> <year> · <count> entries` |
| `all` | every entry | `expenses-all.csv` | `📄 All months · <count> entries` |

The current month SHALL be the month of the local date in the household timezone at the time the command is handled. A month SHALL be four digits, `-` and two digits from `01` to `12`.

The file SHALL hold the active entries only, ordered by spent-on date and then by id, with these columns in this order:

| Column | Content |
|---|---|
| `id` | the entry id |
| `spent_on` | the spent-on date |
| `amount` | the amount in pesos |
| `currency` | the currency |
| `category_id` | the category id |
| `category_name` | the category's name, or the id when the category is not in the category list |
| `description` | the description |
| `payer_name` | the payer's display name in the member records, or the user id when there is none |
| `created_at` | the creation time |
| `deleted_at` | the removal time, which is empty for an active entry |
| `raw_text` | the raw text of the message |

The bot SHALL answer with exactly one message, sent as a reply to the command: the file as a document, with the caption. The caption SHALL say `1 entry` when the count is 1.

When no active entry matches, the bot SHALL send no file and SHALL reply `No entries for <month name> <year>.`, or `No entries yet.` for `all`. When the text is anything else, the bot SHALL send no file and SHALL reply `Usage: /export, /export 2026-08 or /export all`.

Rationale: the household owns the data, and a file on both phones is a copy outside the database.

#### Scenario: Happy path — the current month
- **GIVEN** entry 7 is the only active entry dated in September 2026
- **WHEN** Ana sends `/export`
- **THEN** the bot replies once, to the command, with a document named `expenses-2026-09.csv` and the caption `📄 September 2026 · 1 entry`
- **AND** the file holds the header row `id,spent_on,amount,currency,category_id,category_name,description,payer_name,created_at,deleted_at,raw_text` and the row of entry 7

#### Scenario: Happy path — another month
- **GIVEN** entries dated 2026-07-31, 2026-08-01, 2026-08-31 and 2026-09-01
- **WHEN** Ana sends `/export 2026-08`
- **THEN** the file is named `expenses-2026-08.csv`, its caption is `📄 August 2026 · 2 entries`, and it holds only the entries dated 2026-08-01 and 2026-08-31, in that order

#### Scenario: Failure — text that is not a month
- **WHEN** Ana sends `/export august`, `/export 2026-13`, `/export 2026-8` or `/export 2026-08 extra`
- **THEN** the bot sends no file and replies once: `Usage: /export, /export 2026-08 or /export all`

#### Scenario: Failure — nothing to export
- **GIVEN** no active entry is dated in August 2026, and the ledger holds entries of other months
- **WHEN** Ana sends `/export 2026-08`
- **THEN** the bot sends no file and replies once: `No entries for August 2026.`

#### Scenario: Edge case — everything
- **GIVEN** active entries dated 2025-12-30, 2026-08-15 and 2026-09-29
- **WHEN** Ana sends `/export all`
- **THEN** the file is named `expenses-all.csv`, its caption is `📄 All months · 3 entries`, and it holds the three entries, earliest date first

#### Scenario: Edge case — removed entries are left out
- **GIVEN** September 2026 holds entry 7 and one removed entry
- **WHEN** Ana sends `/export`
- **THEN** the file holds entry 7 only, and the caption says `1 entry`

#### Scenario: Edge case — casing and spacing of the text
- **WHEN** Ana sends `/export   ALL  ` or `/export All`
- **THEN** the reply is the same as for `/export all`

#### Scenario: Edge case — a name or a category that is not known
- **GIVEN** an entry whose payer has no member record, and whose category id `snacks` is not in the category list
- **WHEN** it is exported
- **THEN** its `payer_name` cell holds the user id, and its `category_name` cell holds `snacks`

### Requirement: The system SHALL send a nightly backup at 23:00

The bot SHALL register a job named `nightly_backup` that runs daily at 23:00 household time. A run SHALL send two documents to the backup chat, each without a notification sound, the entries file first:

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

### Requirement: The system SHALL send backups to the configured chat

The backup chat SHALL be the chat named by the setting `BACKUP_CHAT_ID`, read when the job runs. When the setting is absent, the backup chat SHALL be the group. The setting SHALL hold a whole number, which may be negative, as a number or as text. When it holds anything else, the run SHALL send nothing and SHALL fail with the error `BACKUP_CHAT_ID is not a chat id`, so that `/ping` shows the failed run.

Rationale: the backup files can go to a private chat with the bot instead, which keeps the group free of them.

#### Scenario: Happy path — no setting
- **GIVEN** `BACKUP_CHAT_ID` is not defined
- **WHEN** the nightly backup runs
- **THEN** both files are sent to chat `-1001`

#### Scenario: Happy path — a private chat
- **GIVEN** `BACKUP_CHAT_ID` is `1001`
- **WHEN** the nightly backup runs
- **THEN** both files are sent to chat `1001`, and nothing is sent to the group

#### Scenario: Failure — a value that is not a chat id
- **GIVEN** `BACKUP_CHAT_ID` is `ana`, `12.5` or an empty text
- **WHEN** the tick of `2026-09-30T15:00:00Z` fires
- **THEN** nothing is sent, and the run record of `nightly_backup` for `2026-09-30` is `failed` with the last error `BACKUP_CHAT_ID is not a chat id`

#### Scenario: Edge case — a supergroup id given as text
- **GIVEN** `BACKUP_CHAT_ID` is the text `-1001234567890`
- **WHEN** the nightly backup runs
- **THEN** both files are sent to chat `-1001234567890`

### Requirement: The system SHALL provide a restore script and procedure

The project SHALL provide a script that reads backup files, in the order they are given, and prints SQL statements that put their rows back into the database. For each row of an entries file it SHALL print one statement that inserts the entry with its original id and every stored field, and replaces a stored entry that has the same id. For each row of a learned keywords file it SHALL print one statement that does the same for the keyword. The script SHALL undo the CSV format exactly: it SHALL take the added `'` off a cell, read quoted cells, turn an amount back into whole centavos without rounding, and write an empty cell of a field that may be absent as an absent value. It SHALL ignore the columns `category_name` and `payer_name`, which are not stored.

When the same id appears in several files, the statement of the file given last SHALL take effect, so that files given oldest first restore the newest state. When a file is not a backup file, the script SHALL print no statement at all, SHALL name the file in an error message, and SHALL end with a non-zero status. A file made by `/export` is not a backup file.

The project SHALL document the restore procedure: which files to collect from the chat, how to run the script, how to apply its output to a database, and what a backup does not hold.

Rationale: a backup that was never restored is a hope, not a backup. The epic's exit criteria ask for one restore drill into a scratch database.

#### Scenario: Happy path — an entry comes back as it was
- **GIVEN** the backup file of the scenario "Happy path — a night's backup"
- **WHEN** the script is run on it, and its output is applied to an empty database that has the migrations
- **THEN** the database holds entry 7 with the chat id `-1001`, the amount 25000 centavos, and every other stored field as it was before the backup

#### Scenario: Failure — a file that is not a backup file
- **WHEN** the script is run on a file made by `/export`, or on a file whose header row is not one of the two backup headers
- **THEN** it prints no statement, its error message names the file, and it ends with a non-zero status

#### Scenario: Edge case — quoted and neutralized cells
- **GIVEN** a backup row whose description cell is `"'=1,2"`, and whose raw text cell holds two lines inside double quotes
- **WHEN** the script is run on it
- **THEN** the restored description is `=1,2`, and the restored raw text holds both lines

#### Scenario: Edge case — the same entry in two files
- **GIVEN** the backup of `2026-09-29` holds entry 7 as active, and the backup of `2026-09-30` holds it as removed
- **WHEN** the script is run on both files, the older one first, and its output is applied
- **THEN** the database holds entry 7 once, removed

#### Scenario: Edge case — absent values and centavos
- **GIVEN** a backup row with an empty `confirmation_message_id`, an empty `deleted_at`, an empty description and the amount `1500.50`
- **WHEN** the script is run on it
- **THEN** the restored entry has no confirmation message id and no removal time, an empty description, and the amount 150050 centavos

#### Scenario: Edge case — the procedure is documented, verified by review
- **WHEN** a member follows the restore document with one night's backup files and a scratch database
- **THEN** the scratch database holds the entries and the learned keywords of those files
