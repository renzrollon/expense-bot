# Backup and restore

Every night the bot sends the ledger to a Telegram chat as two CSV files. This guide explains what those files hold, how to save them, and how to turn them back into database rows. Practise the restore on a scratch database first, then use the same steps on the real one.

You need the repository checked out, Node.js 24 or later, and `npm install` done once, as in the [Setup guide](setup.md). Restoring to the real database also needs `npx wrangler login`.

## What the nightly backup holds

At 23:00 household time the job `nightly_backup` sends two documents, without a notification sound. They go to the chat set in `BACKUP_CHAT_ID` under `vars` in `wrangler.jsonc`. When that setting is absent, they go to the household group.

| File | Caption | Holds |
|---|---|---|
| `backup-entries-<date>.csv` | `🗄 Backup · <date> · <count> entries` | The entries dated from the 1st of the previous month onward, plus any older entry that was stored or changed since that day. Removed entries are included, with their removal time. |
| `backup-keywords-<date>.csv` | `🗄 Learned keywords · <date> · <count> keywords` | Every learned keyword. |

`<date>` is the night the file was made. For example, the entries file of 2026-09-30 holds everything dated from 2026-08-01 onward, and every entry changed since 2026-08-01, whatever its date.

An entry that is old and has not changed in months is only in the files from the nights after it was last written. Together, the nightly files hold the whole ledger. A single file does not.

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

- **Entries:** every `backup-entries-*.csv` file you have. If that is too many, take the last file of each month back to the start of the ledger, and the newest file. That is enough, as long as no month is missing.
- **Keywords:** the newest `backup-keywords-*.csv` file. Each one holds every learned keyword.

Use only files named `backup-…`. A file made by `/export` leaves out the fields that a restore needs, and the restore script refuses it.

## Turn the files into SQL

From the repository folder, run the restore script with the files, **oldest first**, and write its output to `restore.sql`:

```sh
npm run --silent restore -- backups/backup-entries-2026-08-31.csv backups/backup-entries-2026-09-30.csv backups/backup-keywords-2026-09-30.csv > restore.sql
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

## Apply it to the real database

Do this only after the drill gave the result you expected.

1. If the database was lost, create it again and set it up as in [Create the database](setup.md#create-the-database), which ends with `npm run db:migrate:remote`. Then store the allowed chat id as in [Store the allowed chat id](setup.md#store-the-allowed-chat-id).
2. If the database still holds data, save a copy of it first:

   ```sh
   npx wrangler d1 export expense-bot --remote --output before-restore.sql
   ```

   A restored row replaces the stored row with the same id. An entry changed after the newest backup goes back to its state in that backup.

3. Apply the SQL:

   ```sh
   npx wrangler d1 execute expense-bot --remote --file restore.sql
   ```

## Check the result

Count what came back:

```sh
npx wrangler d1 execute expense-bot --remote --command "SELECT (SELECT COUNT(*) FROM expenses) AS entries, (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL) AS active, (SELECT MAX(spent_on) FROM expenses) AS latest, (SELECT COUNT(*) FROM keyword_map) AS keywords"
```

`entries` should match the number of distinct ids across the entries files, and `keywords` the caption of the keywords file. `latest` is the newest spent-on date, which should be close to the date of the newest backup. Then send `/month` in the group and compare it with what you expect.

## Open a file in a spreadsheet

The files are UTF-8 text with no byte-order mark. Amounts are pesos with two decimals, such as `250.00`.

- **Excel:** do not double-click the file. Choose **Data › From Text/CSV**, pick the file, set **File origin** to **65001: Unicode (UTF-8)** and the delimiter to **Comma**, then choose **Load**. Opened by double-click, Excel may show `piña` as `piÃ±a`.
- **Google Sheets:** choose **File › Import › Upload**, pick the file, and choose **Comma** as the separator. Sheets reads UTF-8 by itself.
- **Numbers:** open the file. Numbers reads UTF-8 by itself.

A cell that starts with `=`, `+`, `-`, `@` or `'` is written with one `'` in front, such as `'-1001` in the `chat_id` column. The `'` stops a spreadsheet from running the cell as a formula. The restore script takes it off again, so do not remove it by hand in a file you plan to restore. Restore from the files as they came from the chat, not from a copy saved by a spreadsheet.
