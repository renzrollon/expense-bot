## Why

The readiness review of 2026-10-03 (`docs/telegram-readiness.md`) found nothing that blocks a first deploy, and six things that would hurt in the first weeks of real use. With privacy mode off the parser logs ordinary chat as expenses (`see you at 7` becomes ₱7). A button press is matched to an entry by id alone, so after rows are lost an old button changes an unrelated entry. The setup guide fails a first deploy in four places when followed literally. A failed backup is silent. The restore runbook lets the bot go live before the restore. `/export all` is expected to pass the free plan's CPU limit at about 2,000 entries, and it would then be stopped without a reply.

The review lists twelve fixes under "Fix before real use". The first round of this change did six of them. A second round, on the same day, does the other six and the rest of the guide fixes:

- a reply to a deleted command message fails for good;
- a late press on a stale button parks its update;
- one 3-hour catch-up window loses a late digest or recap, and lets a nudge come after midnight;
- the last of several unmarked numbers wins, so `grab 180 (2 rides)` is logged as ₱2;
- Telegram rate limits are not waited out, and a hung call can outlast the update lease;
- `/ping` and the logs give no reason for a failure;
- a skipped backup is silent, and a restore needs a file from every month.

The user asked for these to be fixed and for the open decisions to be made without questions. `design.md` records each decision with its evidence.

## What Changes

- **Parser gate.** Capture ignores a forwarded message and a message sent through another bot. The parser no longer reads these as amounts: a plain number after a word such as `at`, `otp` or `ref`; a plain number written with a leading zero; plain numbers in a group of three or more, or in a group with a leading zero (phone, card and account numbers); a number with a `+` joined to its front. **BREAKING for typing habits:** `may` and `jan` name a month only after a day number (`2 may`), because both are everyday Tagalog words. A year after a month and day (`oct 1, 2026`) is part of the date and no longer an amount.
- **Button presses.** A press acts only when the pressed message is the confirmation of the entry its data names. Any other press is answered `This button no longer works.` and changes nothing.
- **Backup failure alert.** A job can ask the scheduler for an alert. When the catch-up window of a scheduled date has ended and the run is failed or interrupted, the scheduler tells the group once, without a sound. The nightly backup asks for it.
- **`/export all` limit.** The household stays on the Workers Free plan. `/export all` counts the active entries first, and above 1,500 it answers with a text that says to export one month at a time.
- **Setup guide.** `wrangler d1 create` with `--binding DB`; the secrets go up with the first deploy through `--secrets-file`; `BOT_INFO` has an example and `bot-info --escaped` prints it ready to paste; the paragraph on invalid settings says what each setting does.
- **Tests no longer read live settings.** `NUDGE_ENABLED` and `NUDGE_HOUR` are pinned in the Vitest bindings, the backup tests remove `BACKUP_CHAT_ID`, and the config test accepts comments and trailing commas.
- **Restore runbook.** A lost database is restored before the deploy that points the Worker at it. `.gitignore` covers the runbook's ledger files.

Second round:

- **Command replies.** `/ping`, `/help`, `/today`, `/week`, `/month`, `/export` and `/undo` reply with `allow_sending_without_reply`, so a deleted command message no longer fails the reply.
- **Stale presses.** A press with an unknown prefix is answered through the never-throwing `answerPress`, so a press that is too old to answer is logged, not parked.
- **Telegram calls.** Every call times out after 20 seconds, and a 429 with a `retry_after` of at most 10 seconds is waited out once inside the attempt, in the gateway and in the scheduler.
- **Which number wins.** Among unmarked numbers the parser prefers one written as money (a separator, decimals or `k`), else the largest. The flag stays.
- **Catch-up windows.** A job may give its own window. The weekly digest has 24 hours, the monthly recap 48, the nudge 2. The backup keeps 3.
- **Failure reasons.** `/ping` adds a short reason to a `failed` line. `attempt_failed` and `job_failed` log a reason code, never the message.
- **Backups.** The failure alert also covers a backup that was skipped after the job had run before. Each month the backup sends the whole ledger in parts of 1,000 entries, one part a night, so a restore needs only the last month's files.
- **Runbook and guide.** `docs/backup-restore.md` describes D1 Time Travel, checks for missing entries, and collects files for the snapshot. `docs/setup.md` says to develop locally with a second bot.

### Non-goals

- A gate for every bare number in chat. `bring 2 chairs` and `ay mali, 300 pala` are still logged. That needs the LLM fallback (EB-13) or a confirm-before-log step, which are features.
- Alerts for the digests and the nudge.
- Review findings outside "Fix before real use", such as the edit notice, learned keywords, and the `updated_at` of an edit mark.
- The Workers Paid plan, building CSV files in SQL, and measuring the `/export all` limit on Workers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `expense-parsing`: more numbers that are not amounts, the `+` sign joined to a number, `may` and `jan` as words, dates with a year, and which of several unmarked numbers wins.
- `expense-capture`: forwarded messages and messages sent through another bot are not captured.
- `entry-corrections`: a press acts only from the entry's confirmation.
- `job-scheduler`: the failure alert for a job that asks for one, also after a skip; a catch-up window per job; the reason on `/ping` and in the log.
- `data-export`: the limit of `/export all`, the backup's failure alert, the order of the restore procedure for a lost database, and the monthly snapshot.
- `expense-ledger`: the count of active entries in a period.
- `bot-gateway`: the setup script prints the bot identity ready for the configuration file; command replies survive a deleted message; a stale press never fails the update; Telegram calls time out and wait out short rate limits; failed attempts log a reason code; a job may give a catch-up window.
- `scheduled-digests`: the digest and the recap catch up for one and two days.
- `logging-nudge`: the nudge is skipped when more than 2 hours late.

## Impact

- **Code.** `src/parser/` (`index.ts`, `amounts.ts`, `words.ts`, `phrases.ts`, `dates.ts`), `src/capture/index.ts`, `src/corrections/presses.ts` and `undo.ts`, `src/scheduler/` (`index.ts`, `schedule.ts`, `status.ts`, `store.ts`), `src/gateway/` (`registry.ts`, two optional fields on a job; `bot.ts`; `index.ts`; new `failure.ts`), new `src/telegram/client.ts`, `src/core/index.ts`, `src/reports/index.ts`, `src/config/schedule.ts`, `src/digests/index.ts`, `src/nudge/index.ts`, `src/export/` (`command.ts`, `index.ts`, `backup.ts`), `src/ledger/index.ts`, `scripts/setup.mjs`, new `scripts/lib/jsonc.mjs`.
- **Database.** No migration. The alert uses the existing `job_sends` table with the part `failure_alert`, and the snapshot the part `snapshot`.
- **Configuration.** No new setting and no new secret. `vitest.config.mts` pins the two nudge settings for tests.
- **Dependencies.** None added.
- **Docs.** `docs/setup.md`, `docs/backup-restore.md`, `README.md`, `docs/telegram-readiness.md`, `.gitignore`.
- **Behavior of the deployed bot.** Some chat messages that were logged are now ignored. Messages that start with `may <day>` or `jan <day>` are dated today and flagged instead of backdated. An old button on a message that is not its entry's confirmation stops working. The group can receive one alert after a failed or skipped backup. `/export all` answers with a text once the ledger passes 1,500 active entries. A message with several unmarked numbers may get a different amount, still flagged. A digest or recap missed by an outage arrives up to one or two days late; a late nudge stops at 2 hours. The backup chat gets a third file, a part of the monthly snapshot, on the first night of each month, and on one more night for each further 1,000 entries.
