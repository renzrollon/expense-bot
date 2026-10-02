## Why

The bot can log an expense, and nothing else. A wrong entry can only be removed in the D1 console, nobody can see a total, and no job is registered, so the hourly tick does nothing. Six MVP issues remain in `docs/epic.md`: EB-06, EB-07, EB-08, EB-10, EB-11 and EB-12. Every issue they depend on is built and archived (EB-01 to EB-05 and EB-09), so all six are unblocked now and can ship as one change that completes the MVP.

## What Changes

The issues are built in dependency order inside this one change: shared foundations first, then the features that only read them.

- **Entry corrections (EB-06).** Every confirmation gains inline buttons: `Category` and `Undo` for each active entry, `Restore` for each removed one. `Category` swaps the buttons for the category grid, 3 per row, with `Back`. Every change edits the confirmation in place and posts no new message. `/undo` removes the sender's most recent active entry. Either member can correct any entry, and who did it is recorded. Editing a logged message does not change the ledger, and its confirmation gains the line `✏️ Edit not applied. Undo and resend.`
- **Category learning (EB-07).** When a member picks a category by hand, a description of 1 to 3 words is stored as a learned keyword for that category. The latest correction replaces an earlier one. The button notice says what was learned, for example `acai: Dining from now on`.
- **Spending reports (EB-08).** One report builder gives the spending total, the entry count and per-category totals with shares. `/today`, `/week` and `/month` reply with it. Categories that do not count as spending are left out of the total and listed separately.
- **Scheduled digests (EB-10).** A weekly digest on Sunday at 19:00 covers Monday to Sunday and adds the month-to-date total. A monthly recap on the 1st at 08:00 covers the previous month and adds the 5 largest entries, the daily average and the number of days with entries.
- **Evening nudge (EB-11).** A daily job at 21:00 sends one message with a `No spending today` button, only when no active entry is dated that day. Tapping the button records the day in a new `day_marks` table and edits the nudge into a short acknowledgment. Settings `NUDGE_ENABLED` and `NUDGE_HOUR`.
- **CSV export and backup (EB-12).** `/export`, `/export 2026-08` and `/export all` reply with a CSV file. A nightly job at 23:00 silently sends two backup files: the entries of the current and previous month, removed ones included, and the learned keywords. A restore script and a documented procedure turn backup files back into ledger rows.
- **Shared foundations.**
  - Migration `0005` adds the tables `day_marks` and `job_sends`, the column `expenses.source_edited_at`, and an index on `expenses.updated_at`.
  - The ledger gains six read or mark operations that the features above need, such as find-by-id.
  - The scheduler gains a send-once record, so a job that runs twice for one scheduled date does not send twice.
  - The confirmation is built by one renderer that capture, the buttons, `/undo` and the edit notice all use.
- **Behavior changes to capture.** Each one is small and is listed so it is not a surprise.
  - The confirmation now carries buttons.
  - The date word in a confirmation (`today`, `yesterday`) is now relative to the local date the entry was stored, not the date the message was sent. The two differ only when the first attempt runs after local midnight. This gives every later in-place edit the same date word as the first confirmation, without a new column.
- **Decisions that depart from or sharpen the epic.** `design.md` records each with its reason.
  - Report lines use ` · ` between the parts and are not padded into columns, because Telegram shows plain text in a proportional font.
  - A removed entry is shown as `🗑 removed · …`, not struck through, so confirmations stay plain text.
  - The backup's entries file carries 13 more columns than `/export`, so a restore is exact. It also holds older-dated entries that were stored or changed since the previous month began, so the nightly files together lose nothing.
  - CSV cells that start with `'` are neutralized too, which makes the neutralization reversible on restore.
  - `keyword_map.hit_count` stays at 0. Nothing in the MVP reads it.

### Non-goals

- **EB-13, LLM fallback parsing.** It is optional in the epic, the MVP is complete without it, and it adds an SDK dependency and an API key. It stays a separate change. Migration number `0006` stays reserved for it.
- Changing an entry's amount, date or description in place, and re-parsing an edited message.
- Commands to list or remove learned keywords, and learning from anything but a manual pick.
- Per-person breakdowns, comparison with earlier periods, budgets, projections and charts.
- Streak counts, per-person nudges, and nudges at other times.
- Automatic restore, uploads to cloud storage, and spreadsheet sync.
- Duplicate detection between members.

## Capabilities

### New Capabilities

- `entry-corrections`: the correction buttons and what each press does, the category grid, `/undo`, the notice for an edited message, category learning on a manual pick, and the rules that keep a repeated update from applying a correction twice.
- `spending-reports`: the report builder, the report text, and the commands `/today`, `/week` and `/month`.
- `scheduled-digests`: the weekly digest and the monthly recap jobs, their periods, their text, and sending each once.
- `logging-nudge`: the evening nudge job, its settings, the `No spending today` button, and the `day_marks` record.
- `data-export`: the CSV format, `/export`, the nightly backup job and its backup chat, and the restore script and procedure.

### Modified Capabilities

- `expense-capture`: the confirmation carries correction buttons and is built by the shared renderer, which also defines how removed entries and the edit notice are shown. The date word is relative to the date the entry was stored. An edited message is still not captured, and the scenario now says that the notice belongs to `entry-corrections`.
- `expense-ledger`: adds find-by-id, the edit mark of a source message, the largest entries in a period, the days with entries in a period, the entries for a backup window, and a member's removal at a given time.
- `categorization`: the learned keywords table is now written. Adds teaching a keyword, the rule for which descriptions are learned, and a full read of the table for the backup.
- `job-scheduler`: adds the send-once record that jobs use to send each message at most once per scheduled date.

`bot-gateway` does not change. Its registration, routing, `/ping` and `/help` requirements already cover commands, button prefixes, edited-message handlers, jobs and status lines from new modules.

## Impact

- **Code.** New directories `src/corrections/`, `src/reports/`, `src/digests/`, `src/nudge/`, `src/export/`, `src/telegram/` and `src/config/`. New files `src/capture/confirmation.ts`, `src/categories/learn.ts` and `src/scheduler/sends.ts`. Changed files: `src/capture/index.ts` and `src/capture/format.ts`, `src/ledger/index.ts` and `src/ledger/types.ts`, `src/categories/store.ts` and `src/categories/index.ts`, `src/gateway/members.ts` (one read function), and `src/modules.ts`.
- **Database.** Migration `0005_corrections_reports_jobs.sql`. Run `npm run db:migrate:remote` before the deploy that adds it.
- **Configuration.** `wrangler.jsonc` gains the settings `NUDGE_ENABLED` and `NUDGE_HOUR`. `BACKUP_CHAT_ID` is optional and defaults to the group. No new secret.
- **Dependencies.** None added. File uploads use `InputFile` from grammY `1.46.0`, which is already pinned.
- **Scripts and docs.** `scripts/restore.mjs` with its tests, a new `docs/backup-restore.md`, new settings rows in `docs/setup.md`, and the command list in `README.md`.
- **Tests.** New unit and Workers-runtime tests for every capability. `test/helpers/telegram.ts` learns to read a multipart upload. Existing capture, ledger, entry and migration tests change where they assert the confirmation payload, the `/help` list, the job list or the table list.
- **Behavior of the deployed bot.** `/help` lists five more commands. `/ping` shows four jobs. The group starts to receive the nudge, the digests and the nightly backup files.
