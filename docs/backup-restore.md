# Backup and restore

Every night the bot sends the ledger to a Telegram chat as CSV files. This guide explains what those files hold, how to save them, and how to turn them back into database rows. Practise the restore on a scratch database first, then use the same steps on the real one. For a change that went wrong in the last 7 days, [Time Travel](#undo-a-bad-change-with-time-travel) is quicker than the files.

You need the repository checked out, Node.js 24 or later, and `npm install` done once, as in the [Setup guide](setup.md). Restoring to the real database also needs `npx wrangler login`.

## What the nightly backup holds

At 23:00 household time the job `nightly_backup` sends two documents, and in the first nights of each month a third, without a notification sound. They go to the chat set in `BACKUP_CHAT_ID` under `vars` in `wrangler.jsonc`. When that setting is absent, they go to the household group.

| File | Caption | Holds |
|---|---|---|
| `backup-entries-<date>.csv` | `🗄 Backup · <date> · <count> entries` | The entries dated from the 1st of the previous month onward, plus any older entry that was stored or changed since that day. Removed entries are included, with their removal time. |
| `backup-keywords-<date>.csv` | `🗄 Learned keywords · <date> · <count> keywords` | Every learned keyword. |
| `backup-snapshot-part-<n>-<date>.csv` | `🗄 Snapshot part <n> of <parts> · ids <first>–<last> · <date> · <count> entries` | Sent on the night of day *n* of each month: entries 1 to 1,000 on the 1st, 1,001 to 2,000 on the 2nd, and so on, removed entries included. Nothing is sent on a night whose part would be empty, or after the 28th. |

`<date>` is the night the file was made. For example, the entries file of 2026-09-30 holds everything dated from 2026-08-01 onward, and every entry changed since 2026-08-01, whatever its date.

An entry that is old and has not changed in months is not in the recent entries files. The snapshot parts hold it: entries are never deleted, so the ids from 1 to the newest id are the whole ledger, and the parts of one month hold all of them. The caption of each part says how many parts there are.

Each entries row holds every stored field of the entry, so a restore is exact. The columns `category_name` and `payer_name` are there to make the file readable, and the restore ignores them.

A file with no rows is still sent, with its header row.

### What a backup does not hold

- **Members.** The member records come back by themselves: the bot writes a member's record again when that member sends a message.
- **Settings.** That includes the allowed chat id. Store it again as in [Store the allowed chat id](setup.md#store-the-allowed-chat-id). The settings in `wrangler.jsonc` and the secrets are not in the database, so a restore does not affect them.
- **No-spending days.** The days marked with the evening nudge's `No spending today` button are lost.
- **Job records.** The record of which jobs ran, and which digests, nudges and backups were sent, is lost. After a restore into an empty database, a job that is still due can send its message for that date a second time.

## Save the files from the chat

Save the files under their own names. The date in the name tells you which file is older.

- **Telegram on Android:** tap the file, then open the `⋮` menu and choose **Save to Downloads**.
- **Telegram on iPhone:** tap the file, tap the share button, and choose **Save to Files**.
- **Telegram Desktop:** right-click the file and choose **Save As…**.

Put the files in one folder on the computer that has the repository.

Which files to collect:

- **Snapshot:** for each part number, the newest `backup-snapshot-part-<n>-*.csv` file. The newest part's caption says `part <n> of <parts>`, so you know how many to look for.
- **Entries:** the newest `backup-entries-*.csv` file. It holds every change since the 1st of the month before it, which brings the snapshot parts up to date.
- **Keywords:** the newest `backup-keywords-*.csv` file. Each one holds every learned keyword.

Two cases need more entries files:

- **A part's newest file is older than the 1st of the month before the newest entries file**, for example because the backup failed that night. Also take the last entries file of each month from that part's month on.
- **The bot has not yet sent a full snapshot**, because it was deployed less than a month ago. Take every entries file you have.

Use only files named `backup-…`. A file made by `/export` leaves out the fields that a restore needs, and the restore script refuses it.

## Turn the files into SQL

From the repository folder, run the restore script with the files, **oldest first**, and write its output to `restore.sql`. The snapshot parts go before the entries files:

```sh
npm run --silent restore -- backups/backup-snapshot-part-1-2026-10-01.csv backups/backup-snapshot-part-2-2026-10-02.csv backups/backup-entries-2026-10-15.csv backups/backup-keywords-2026-10-15.csv > restore.sql
```

Keep `--silent`. Without it, npm writes its own two-line banner into `restore.sql`, and the file is no longer valid SQL.

The script applies nothing. It prints one `INSERT OR REPLACE` statement per row. A statement replaces a stored row with the same id, so when an entry is in several files, the file given last wins. That is why the files go oldest first. It is also why running the same `restore.sql` twice is safe.

When a file is not a backup file, the script prints no SQL at all, names the file in its error message, and ends with a non-zero status. Remove or replace that file and run it again. Check that `restore.sql` starts with `INSERT OR REPLACE` before you go on.

## Apply it to a scratch database

A scratch database is a local copy that the bot never uses. The commands below keep it in the folder `.wrangler/restore-drill`, apart from the database that `npm run dev` uses.

1. Create the tables:

   ```sh
   npx wrangler d1 migrations apply expense-bot --local --persist-to .wrangler/restore-drill
   ```

2. Apply the SQL:

   ```sh
   npx wrangler d1 execute expense-bot --local --persist-to .wrangler/restore-drill --file restore.sql
   ```

3. Check the result, as in [Check the result](#check-the-result), with `--local --persist-to .wrangler/restore-drill` in place of `--remote`.

To start the drill again from empty, delete the folder `.wrangler/restore-drill`.

## Undo a bad change with Time Travel

D1 keeps the history of the database itself. On the Workers Free plan you can put the whole database back to how it was at any minute of the last 7 days, without any backup file. Use this when the database still exists and something changed it wrongly, such as a mistaken `d1 execute` or a bad deploy.

It puts back every table: entries, keywords, settings, members, no-spending days, and the records of updates and jobs. Everything written after that minute is lost, including entries the group logged since. Note those entries first, so the members can send them again.

1. Save a copy of the database as it is now:

   ```sh
   npx wrangler d1 export expense-bot --remote --output before-restore.sql
   ```

2. Choose the time, in UTC. 14:00 on 2 October in Manila is `2026-10-02T06:00:00Z`. Check that D1 has that point:

   ```sh
   npx wrangler d1 time-travel info expense-bot --timestamp=2026-10-02T06:00:00Z
   ```

3. Restore it:

   ```sh
   npx wrangler d1 time-travel restore expense-bot --timestamp=2026-10-02T06:00:00Z
   ```

4. Check the result, as in [Check the result](#check-the-result), then send `/ping` and `/month` in the group.

No deploy is needed: the Worker keeps using the same database. For a database that was deleted, or a mistake older than 7 days, use the files below.

## Apply it to the real database

Do this only after the drill gave the result you expected. Use the steps for your case.

### The database was lost

Restore before the bot can log anything. A new entry in an empty database takes id 1, and the restore would then replace it with the old entry that has id 1. The deployed Worker still points at the lost database, so until step 6 it stores nothing, and Telegram keeps the group's messages for up to 24 hours.

1. Create the database again:

   ```sh
   npx wrangler d1 create expense-bot --binding DB
   ```

   This writes the new `database_id` into `wrangler.jsonc`, as in [Create the database](setup.md#create-the-database). Do not deploy yet.

2. Create the tables:

   ```sh
   npm run db:migrate:remote
   ```

3. Apply the SQL:

   ```sh
   npx wrangler d1 execute expense-bot --remote --file restore.sql
   ```

4. Check what came back, as in [Check the result](#check-the-result), without the `/month` step.
5. Store the allowed chat id, as in [Store the allowed chat id](setup.md#store-the-allowed-chat-id).
6. Deploy, so that the Worker uses the new database:

   ```sh
   npm run deploy
   ```

7. Send `/ping`, then `/month`, in the group. The messages that Telegram kept are logged now, after the restored entries.

### The database still holds data

1. Save a copy of it first:

   ```sh
   npx wrangler d1 export expense-bot --remote --output before-restore.sql
   ```

   A restored row replaces the stored row with the same id. An entry changed after the newest backup goes back to its state in that backup.

2. Apply the SQL:

   ```sh
   npx wrangler d1 execute expense-bot --remote --file restore.sql
   ```

Keep the backup files, `restore.sql` and `before-restore.sql` out of git: they hold the whole ledger. The repository's `.gitignore` covers the folder `backups/` and those two file names at the top of the repository.

## Check the result

Count what came back:

```sh
npx wrangler d1 execute expense-bot --remote --command "SELECT (SELECT COUNT(*) FROM expenses) AS entries, (SELECT MAX(id) - COUNT(*) FROM expenses) AS missing, (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL) AS active, (SELECT MAX(spent_on) FROM expenses) AS latest, (SELECT COUNT(*) FROM keyword_map) AS keywords"
```

- `missing` must be 0. Entries are never deleted, so their ids have no gaps. Anything above 0 is the number of entries that no file brought back: a snapshot part or a month's entries file was left out. Find it and run the restore again with it.
- `entries` is the number of entries that came back, removed ones included. With `missing` at 0, it is also the newest id in the files.
- `keywords` should match the caption of the keywords file.
- `latest` is the newest spent-on date, which should be close to the date of the newest backup.

Then send `/month` in the group and compare it with what you expect.

## Open a file in a spreadsheet

The files are UTF-8 text with no byte-order mark. Amounts are pesos with two decimals, such as `250.00`.

- **Excel:** do not double-click the file. Choose **Data › From Text/CSV**, pick the file, set **File origin** to **65001: Unicode (UTF-8)** and the delimiter to **Comma**, then choose **Load**. Opened by double-click, Excel may show `piña` as `piÃ±a`.
- **Google Sheets:** choose **File › Import › Upload**, pick the file, and choose **Comma** as the separator. Sheets reads UTF-8 by itself.
- **Numbers:** open the file. Numbers reads UTF-8 by itself.

A cell that starts with `=`, `+`, `-`, `@` or `'` is written with one `'` in front, such as `'-1001` in the `chat_id` column. The `'` stops a spreadsheet from running the cell as a formula. The restore script takes it off again, so do not remove it by hand in a file you plan to restore. Restore from the files as they came from the chat, not from a copy saved by a spreadsheet.
