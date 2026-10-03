# Telegram readiness review

Reviewed 2026-10-03 at commit `b6bf8f8`. Six reviewers each read one slice of the code line by line (gateway, capture and parser, ledger and corrections, scheduler and reports, export and backup, deploy and docs) and ran experiments for the findings marked **verified**. Findings marked **suspected** were traced in the code but not run.

## Fixed since the review

Updated 2026-10-03, after the review. These fixes are in the OpenSpec change `harden-first-use`, in two rounds on the same day. Every fix in [Fix before real use](#fix-before-real-use) is now done; the last column says what each one still leaves open. The findings below are kept as the review wrote them, so read them with this list.

| Fix | What changed | Still open |
|---|---|---|
| 1, parser gate | Forwarded messages and messages sent through another bot are not captured. A plain number is not an amount after `at`, `alas`, `otp`, `pin`, `code`, `ref`, `reference`, `no`, `number`, `acct`, `account` or `year`, when it starts with a zero, or when it stands in a group of numbers such as a phone or card number. `+1` is not an amount. `may` and `jan` name a month only after a day number. A year after a month and day is part of the date | Chat that holds any other bare number is still logged: `bring 2 chairs`, `ay mali, 300 pala`, a shopping list with quantities. Telling those apart needs the LLM fallback (EB-13) or a confirm-before-log step |
| 2, button presses | A press is refused unless the pressed message is the entry's confirmation | |
| 3, replies | `/ping`, `/help`, `/today`, `/week`, `/month`, `/export` and `/undo` reply with `allow_sending_without_reply`, so a deleted command message no longer fails the reply | |
| 4, stale presses | A press with an unknown prefix is answered through `answerPress`, so a press too old to answer is logged as `callback_answer_failed` instead of parked | A press is still not answered when its handler throws |
| 5, tests and live settings | No test reads `NUDGE_ENABLED`, `NUDGE_HOUR` or `BACKUP_CHAT_ID` from `wrangler.jsonc`, and comments and trailing commas in that file are accepted | |
| 6, guides | `docs/setup.md` uses `--binding DB`, uploads the secrets with the first deploy, shows `BOT_INFO` with an example and `bot-info --escaped`, and describes invalid settings correctly. `docs/backup-restore.md` restores a lost database before the deploy. `.gitignore` covers `/backups/`, `/restore.sql` and `/before-restore*.sql`. `docs/backup-restore.md` also describes D1 Time Travel and checks for missing entries with `MAX(id) - COUNT(*)`. `docs/setup.md` says to run locally with a second bot | |
| 7, backup failures | When the nightly backup has not finished after its 3 hours of attempts, or was skipped after it had run before, the bot tells the group once, without a sound. Each month the backup also sends the whole ledger, 1,000 entries a night from the 1st, so a restore needs only the last month's files | The snapshot stops at 28,000 entries. Until the first full month after the deploy, a restore still needs every month's entries file |
| 8, catch-up windows | Each job gives its own window: 24 hours for the weekly digest, 48 for the monthly recap, 2 for the nudge, 3 for the backup | A `NUDGE_HOUR` of 22 or 23 can still nudge after midnight |
| 9, which number wins | Among numbers without `₱`, one written as money (`1,500`, `180.50`, `1.5k`) wins, else the largest. `grab 180 (2 rides)` is ₱180 and `Paid 1,500 for 3 shirts` is ₱1,500, both still marked `⚠️ check amount` | |
| 10, Telegram limits | Every Telegram call times out after 20 seconds. A 429 with a `retry_after` of at most 10 seconds is waited out once inside the attempt, in the gateway and the scheduler | A longer rate limit still fails the attempt |
| 11, `/export all` | The decision is to stay on the Workers Free plan. `/export all` answers with a text instead of a file when the ledger holds more than 1,500 active entries, so it cannot be stopped without a reply. Building a file took 9 ms for 2,000 rows in Node on this laptop | Not measured on Workers. On the Workers Paid plan, raise `EXPORT_ALL_MAX_ENTRIES` in `src/export/command.ts` |
| 12, failure reasons | `/ping` adds the first 60 characters of the error to a `failed` job line. `attempt_failed` and `job_failed` log a reason code such as `telegram_403`, never the message | |


## Verdict

**The bot is not live yet, and nothing in the code stops a first deploy.** All remaining work to get it answering in the group is setup, listed in [Setup still needed](#setup-still-needed).

| Check | Result |
|---|---|
| `npm test` | Pass: 1,298 Vitest tests in 56 files, plus 54 script tests |
| `tsc --noEmit` (src and test) | Clean |
| `wrangler deploy --dry-run` | Bundles, 261 KiB |
| Security (webhook secret, chat and member allowlist) | Sound; no way found for an outsider to trigger a handler or read anything |
| At-most-once update processing | Sound; 3 parallel deliveries of one update ran the handler once |
| Scheduler | Sound; two simulated weeks of doubled hourly ticks gave no duplicate and no missed send |
| Money arithmetic | Sound; integer centavos everywhere, no floats |
| Backup and restore round trip | Sound; every column survived two round trips with awkward values |

Three things deserve a decision before the household relies on it. They are detailed in [Fix before real use](#fix-before-real-use):

1. **The parser logs ordinary chat as expenses.** With privacy mode off, `see you at 7` becomes ₱7 and `OTP: 123456` becomes ₱123,456. Every such entry posts a confirmation with an Undo button, so none is silent, but the group has to be kept for expenses only until the parser has a gate.
2. **A button press is not tied to the message it is on.** After a database wipe or restore, entry ids are reused, and an old Undo or Category button then changes an unrelated new entry.
3. **`docs/setup.md` has four traps** that can fail a first deploy when followed literally. The checklist below avoids them.

## Setup still needed

Current state: no bot token, no `.dev.vars`, Wrangler not logged in, no database (`wrangler.jsonc` holds the placeholder id), `BOT_INFO` is `{}`, `ALLOWED_USER_IDS` is `[]`, nothing deployed, no webhook.

[setup.md](setup.md) now follows the same order and explains each step in more detail. **By hand** marks steps only you can do. None of these steps was run against a real Cloudflare or Telegram account during the review; the commands and flags were checked against Wrangler 4.143.0 and the scripts.

Do steps 12 to 15 in one sitting, and ask members not to log expenses until step 15 succeeds: step 13 discards everything sent before it.

### Telegram side

1. **By hand: create the bot.** In [@BotFather](https://t.me/BotFather) send `/newbot` and choose a name and a username ending in `bot`. Then:

   ```sh
   npm ci
   cp .dev.vars.example .dev.vars
   ```

   Put the token in `.dev.vars` as `BOT_TOKEN=<token>`. Use plain `KEY=value` lines with no quotes, comments or `export`.

   Check: `npm run --silent setup -- bot-info` prints one line of JSON with the bot's `username`.

2. **By hand: turn privacy mode off.** In BotFather send `/setprivacy`, choose the bot, choose `Disable`.

3. **By hand: register the command menu.** The guide never mentions this, and nothing in the code does it. In BotFather send `/setcommands`, choose the bot, and paste:

   ```
   ping - bot status
   help - list the commands
   today - spending today
   week - spending this week
   month - spending this month
   undo - remove your last entry
   export - CSV file: /export, /export 2026-08, /export all
   ```

4. **By hand: add the bot to the household group.** If it is already there, remove it and add it again, because Telegram applies the privacy setting only when the bot joins. Each member then sends one plain message such as `hi`.

   Check: `npm run --silent setup -- bot-info` now shows `"can_read_all_group_messages":true` and prints no privacy warning.

5. **By hand: stop strangers adding the bot to other groups.** In BotFather send `/setjoingroups`, choose the bot, choose `Disable`. The bot stays in the household group. Without this, anyone can add the bot to a busy group and use up the free plan's daily requests.

6. **Find the ids.**

   ```sh
   npm run --silent setup -- discover
   ```

   Write down the group's chat id (a supergroup's starts with `-100`) and each member's user id.

### Cloudflare side

7. **By hand: log in.** `npx wrangler login` opens a browser. Check with `npx wrangler whoami`.

8. **Create the database.**

   ```sh
   npx wrangler d1 create expense-bot --binding DB --location apac
   ```

   Run without `--binding DB`, Wrangler asks three questions and its default answers add a second binding named `expense_bot` while `DB` keeps the placeholder id.

   Check: `d1_databases` in `wrangler.jsonc` has exactly one entry, with binding `DB`, `migrations_dir` `migrations` and a real id. Fix it by hand if not.

9. **Apply the migrations.** `npm run db:migrate:remote`, and answer `Y` to the confirmation.

   Check: `npx wrangler d1 migrations list expense-bot --remote` shows nothing left to apply.

10. **Fill in the settings** under `vars` in `wrangler.jsonc`.

    - `BOT_INFO` must be the `bot-info` JSON written as a string with every quote escaped. This prints a value to paste after `"BOT_INFO": `:

      ```sh
      npm run --silent setup -- bot-info --escaped
      ```

    - `"ALLOWED_USER_IDS": "[<id1>, <id2>]"`.
    - `HOUSEHOLD_TZ`, `NUDGE_ENABLED`, `NUDGE_HOUR` and `BACKUP_CHAT_ID` are yours to set. No test reads them any more.

    Check: this prints the bot id, the username and the member ids.

    ```sh
    node -e 'const v=JSON.parse(require("fs").readFileSync("wrangler.jsonc","utf8")).vars;const b=JSON.parse(v.BOT_INFO);console.log(b.id,b.username,JSON.parse(v.ALLOWED_USER_IDS))'
    ```

    Then `npm test` and `npm run typecheck` still pass. Commit `wrangler.jsonc`.

11. **Generate the webhook secret.** `npm run --silent setup -- secret`, and put the value in `.dev.vars` as `WEBHOOK_SECRET=<value>`. `.dev.vars` must hold exactly these two lines.

12. **Store the allowed chat id** (keep the single quotes and the leading `-`):

    ```sh
    npx wrangler d1 execute expense-bot --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', '<chat id>', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ```

    Check: `npx wrangler d1 execute expense-bot --remote --command "SELECT key, value FROM settings"` returns the id.

13. **By hand: first deploy, with the secrets.**

    ```sh
    npx wrangler deploy --secrets-file .dev.vars
    ```

    This uploads both secrets with the first deploy, so the deployed secret is the one the webhook step sends. The guide's path (`wrangler secret put` before the first deploy) works only if you answer `Y` when Wrangler offers to create the Worker; answering `n` makes the deploy fail on `secrets.required`. If Wrangler asks to register a `workers.dev` subdomain, say yes and choose a name.

    Check: Wrangler prints `https://expense-bot.<subdomain>.workers.dev` and the `0 * * * *` schedule. This prints `401`:

    ```sh
    curl -s -o /dev/null -w "%{http_code}\n" -X POST https://expense-bot.<subdomain>.workers.dev/webhook
    ```

14. **Register and check the webhook.** The address must end in `/webhook`; `verify` does not catch a wrong path until a real message fails.

    ```sh
    npm run setup -- webhook https://expense-bot.<subdomain>.workers.dev/webhook --drop-pending
    npm run setup -- verify
    ```

    Check: `verify` exits 0 with `Pending updates: 0` and `Last error: none`.

15. **By hand: try it in the group.** Send `/ping`. Expect:

    ```
    🏓 expense-bot 0.1.0
    Database: ok · <n> ms
    Last update: none yet
    Parked updates: none
    Job weekly_digest: not run yet
    Job monthly_recap: not run yet
    Job evening_nudge: not run yet
    Job nightly_backup: not run yet
    ```

    After the first hourly tick the job lines read `skipped` with an old date. That is expected. Then send `/help`, then `lunch 250` (expect a confirmation with `Category` and `Undo` buttons), tap `Undo`, and send `/today`. Run `npx wrangler tail expense-bot` to watch the logs meanwhile.

    Remove test entries with Undo. If you delete rows instead, entry ids are used again; an old button then answers `This button no longer works.` and changes nothing.

### After it answers

16. **Agree the group rules.** Keep the group mostly for expenses: the parser now leaves out times, codes, phone numbers and forwards, but other chat that holds a bare number is still logged. Check that the group has no auto-delete timer: the nightly backup files are posted there and are the only backup.
17. **Run the restore drill** in [backup-restore.md](backup-restore.md) after the first 23:00 backup.
18. **Add a git remote.** The repository has none, so the code and the committed config exist only on this laptop.
19. **Archive the OpenSpec change** `add-corrections-reports-jobs`. All 35 tasks are checked, but until it is archived `openspec/specs/` lacks the entry-corrections, spending-reports, scheduled-digests, logging-nudge and data-export specs.

If something does not answer:

| Symptom | Likely cause | Look at |
|---|---|---|
| `verify` shows a 401 error | The deployed `WEBHOOK_SECRET` differs from `.dev.vars` | Redo steps 13 and 14 |
| `verify` shows a 500 error | A setting is invalid | `config_invalid` in `wrangler tail` names it |
| `verify` shows a 503 error | The database binding is wrong | `database_id` in `wrangler.jsonc` |
| No reply, no error | The chat id row is missing or stale | `SELECT key, value FROM settings` |
| A command got no reply | The update failed three times and was parked | `SELECT update_id, status, attempts, last_error FROM updates WHERE status IN ('failed','parked') ORDER BY received_at DESC LIMIT 10` |
| A job shows `failed` in `/ping` | The reason is stored only in the database | `SELECT job, scheduled_date, status, attempts, last_error FROM job_runs ORDER BY scheduled_date DESC LIMIT 20` |

## Fix before real use

None of these blocks the deploy. The first group is cheap and removes the failures most likely to be met in the first week.

### Before the household starts logging

| # | Fix | Where | Size |
|---|---|---|---|
| 1 | Gate the parser against ordinary chat: ignore forwards and `via_bot` messages, phone-like and card-like digit groups, and bare numbers after words such as `at`, `otp`, `ref`. Stop reading Tagalog `may` and `jan` as months when they come first, and read a year after a month-day as part of the date | `src/parser/`, `src/capture/index.ts` | Medium; needs a spec change |
| 2 | Refuse a press unless the entry belongs to the pressed message (`entry.confirmationMessageId` equals the pressed message id, or the pressed message replies to the entry's source message) | `src/corrections/presses.ts:46` | Small |
| 3 | Add `allow_sending_without_reply: true` to the four replies that lack it | `src/core/index.ts:59`, `src/reports/index.ts:30`, `src/export/command.ts:79`, `src/corrections/undo.ts:53` | Trivial |
| 4 | Answer stale presses with the never-throwing `answerPress` | `src/gateway/bot.ts:51` | Trivial |
| 5 | Stop the tests reading live values from `wrangler.jsonc`: pin `NUDGE_ENABLED`, `NUDGE_HOUR` and the absence of `BACKUP_CHAT_ID` in the Vitest bindings | `vitest.config.mts`, `scripts/wrangler-config.test.mjs`, `test/backup.test.ts:259` | Small |
| 6 | Correct `docs/setup.md` and the restore order in `docs/backup-restore.md`; ignore `/backups/`, `/restore.sql` and `/before-restore*.sql` in `.gitignore` | docs, `.gitignore` | Small |

### Soon after

| # | Fix | Where |
|---|---|---|
| 7 | Post an alert to the group when a backup's last attempt fails, and send a full snapshot monthly so one file is enough to restore | `src/export/backup.ts`, `src/scheduler/` |
| 8 | Give each job its own catch-up window: a day or two for the digest and recap, an hour or two for the nudge | `src/scheduler/schedule.ts:4` |
| 9 | Among unmarked numbers, prefer the one with grouping, decimals or `k`, else the largest, instead of the last | `src/parser/index.ts:192` |
| 10 | Wait out short Telegram rate limits (429) inside the attempt; set the API timeout near 20 s | `src/gateway/bot.ts` |
| 11 | Decide on the Workers Paid plan, or cap `/export all`, before the ledger passes about 2,000 entries | `src/export/command.ts` |
| 12 | Show a short failure reason on `/ping`'s `failed` lines and in the logs | `src/scheduler/status.ts`, `src/gateway/index.ts:126` |

## Findings by area

Severity: **Major** will bite in real use; **Minor** is a rough edge or a rare failure. Nits are listed at the end of each area.

### Capture, parser and categories

The code matches its specs line for line. Most of these are spec choices that go wrong once every group message reaches the bot. All were verified by running the parser on the exact input, at 2026-10-03 10:00 Manila time.

| Severity | Defect | Examples |
|---|---|---|
| Major | Any standalone number of 7 digits or fewer is an amount, `+` separates items, and forwards and replies are not filtered (`src/parser/amounts.ts:11`, `src/parser/words.ts:43`, `src/capture/index.ts:15`) | `see you at 7` → ₱7 · `+1` → ₱1 · `OTP: 123456` → ₱123,456 · `call me 0917 123 4567` → ₱4,567 · a three-line shopping list → 3 entries · `ay mali, 300 pala` → a second ₱300 entry |
| Major | Tagalog `may` and `jan` are read as months (`src/parser/phrases.ts:21`) | `may 2 kape 300` → dated May 2 · from January to April the same message is rejected as a future date |
| Major | A year in a date becomes an amount (`src/parser/phrases.ts:75`) | `lunch 250 on Oct 1, 2026` → ₱250 and ₱2,026 · `lunch 250 oct 3 2026` → stores ₱2,026 · `Happy New Year 2026!` → ₱2,026 |
| Major | The last number wins, so a trailing quantity replaces the price (`src/parser/index.ts:192`) | `grab 180 (2 rides)` → ₱2 · `Paid 1,500 for 3 shirts` → ₱3. All are flagged `⚠️ check amount`, and the only correction is Undo and resend |
| Minor | Ordinary chat gets rejection replies that cannot be dismissed | `see you on oct 15 at 7` → "the date is in the future" · `lol 0` → amount out of range |
| Minor | Common date forms are ignored and the entry is dated today | `9/28 lunch 250` · `sep 28th lunch 250` · `last friday grab 300` |
| Minor | Common no-space forms are silently not captured | `lunch-250` · `lunch 250php` · `₱250lunch` · `coffee 2x150` |
| Minor | Suffix and grouping typos change the amount or split the entry | `lunch 1.5 k` → ₱1.50 · `lunch 1,5k` → ₱1 and ₱5,000 |
| Minor | Forwarding or pasting one of the bot's own messages logs it again | A forwarded two-entry confirmation → 3 new entries |
| Minor | In late December, `jan 2 rent 12000` is stored as last January and its label hides the year (`src/parser/dates.ts:37`) | |
| Minor | One tap teaches any description of 1 to 3 words, a learned word beats every built-in phrase, and nothing lists or forgets learned keywords (`src/corrections/presses.ts:76`) | Re-filing one `grab 250` as Dining sends every later `grab` ride to Dining |

Nits: `Jollibee's`, `7-11` and `kfc` miss the built-in keywords and go to Other; a description holding `@user` or `/cmd` becomes a live mention in the confirmation; `shorten` can split a joined emoji.

### Ledger and corrections

| Severity | Defect | Status |
|---|---|---|
| Major | A press looks the entry up by the id in the button alone and never checks it belongs to the pressed message (`src/corrections/presses.ts:46`). Ids are reused after rows are lost (`migrations/0002_expense_ledger.sql:2` has no AUTOINCREMENT), so after a wipe or restore an old button removes or recategorizes an unrelated entry and rewrites the old message | Verified by running it |
| Minor | `/undo` fails and is parked when the command message is deleted before the reply; the entry is already removed but no reply is sent (`src/corrections/undo.ts:50`) | Verified |
| Minor | A press is not answered when its handler throws, so the button keeps loading (`src/corrections/presses.ts:39`) | Verified by tracing |
| Minor | An edit that arrives before its message is stored is dropped for good, so a retried capture stores the original amount with no edit notice (`src/corrections/edited.ts:17`) | Suspected; depends on Telegram's delivery order |
| Minor | `/undo` picks the entry stored last, not the message sent last (`src/ledger/index.ts:268`) | Verified |
| Minor | Editing a rejected or unparsed message does nothing and says nothing, although editing is the natural reaction to "Not logged" | Verified; the spec requires it |

Nits: the edit notice stays after an edit is reverted; a retried `/undo` can undo a Restore made between its attempts; concurrent presses can leave a message showing a stale state until the next press; `expenses_updated_at` is a dead index; `spent_on` checks shape only, so `2026-02-30` would be accepted from a writer other than the parser; repeated `/undo` walks back through all history; migration 0005 cannot be re-run by hand, so never apply migration files with `d1 execute --file`.

### Gateway, webhook and core commands

| Severity | Defect | Status |
|---|---|---|
| Minor | A stale-button press delivered late gets Telegram's "query is too old" 400, fails three times and is parked (`src/gateway/bot.ts:51`) | Verified |
| Minor | `/ping` and `/help` replies fail for good when the command message is gone (`src/core/index.ts:59`) | Verified |
| Minor | The update lease has no fencing and grammY's API timeout is 500 s against a 120 s lease, so a hung call can let a redelivery run the handlers a second time (`src/gateway/update-log.ts:85`) | Mechanism verified; whether it can happen on Workers is suspected |
| Minor | Strangers can add the bot to their groups; each message there costs a Worker request and a database read | Suspected; step 5 of the checklist closes it |
| Minor | Every 400 from a message edit is swallowed and logged without its reason, so a too-long message looks like a harmless "not found" and the member still sees a success notice (`src/telegram/inplace.ts:34`) | Verified by tracing |
| Minor | No handling of Telegram's 429 rate limit anywhere; three in a row park the update | Suspected |
| Minor | A supergroup upgrade whose notices are missed (during setup, or in an outage over 24 hours) leaves the stored chat id stale, and the ignore log does not name the chat | Suspected |

Nit: after a week with no updates Telegram picks the next update id at random; a collision with a stored id would drop a real update. Very unlikely.

### Scheduler, reports, digests and nudge

| Severity | Defect | Status |
|---|---|---|
| Minor, near Major for the recap | One 3-hour catch-up window for every job: a weekly digest or monthly recap that misses it is never sent, and nothing can re-run it (`src/scheduler/schedule.ts:4`) | Verified |
| Minor | A catch-up nudge can ping the group after midnight, with sound (`src/nudge/index.ts:26`) | Verified |
| Minor | `NUDGE_HOUR` values from 0 to about 6 make the nudge fire every day about a day that has just started (`src/nudge/settings.ts:28`) | Verified |
| Minor | The weekly digest runs Sunday 19:00 for Monday to Sunday, so Sunday dinner and entries backdated later appear in no digest; the same holds for the recap and entries logged after 08:00 on the 1st (`src/config/schedule.ts:8`) | Verified by tracing |

Nits: `/ping` shows `failed` without a reason; a cron invocation delivered hours late would run jobs as if on time; week ranges crossing New Year print no year.

### Export, backup and restore

| Severity | Defect | Status |
|---|---|---|
| Major | The lost-database runbook omits the redeploy and lets the bot go live before the restore. New entries then take ids 1, 2, … and `INSERT OR REPLACE` silently overwrites them with old entries (`docs/backup-restore.md:86`, `scripts/lib/backup-csv.mjs:130`). The safe order is: create database → update the id → migrate → apply `restore.sql` → store the chat id → deploy | Verified by reproducing it |
| Major | Backup failures are silent. A failed run is retried for 3 hours and then dropped, with only `/ping` showing it. Each file covers about two months, so a longer gap, or a one-month auto-delete timer on the group, is permanent loss (`src/export/backup.ts:41`) | Verified by tracing |
| Major | `/export all`, and the nightly backup in a busy household, will pass the free plan's 10 ms CPU limit. CSV building alone took 9.7 ms for 2,000 rows | Suspected; measured in Node on a laptop, not on Workers |
| Minor | `markSourceEdited` and `attachConfirmation` do not bump `updated_at`, so an edit mark on an old entry never reaches a backup (`src/ledger/index.ts:183`, `:332`) | Verified by tracing |
| Minor | A restore depends on file order and overwrites newer live rows | Verified; it is the specified design |
| Minor | The runbook's check cannot detect a missing month. `SELECT MAX(id) - COUNT(*) FROM expenses` should be 0 | Verified by tracing |
| Minor | The runbook never mentions D1 Time Travel, which restores every table for up to 7 days back | |
| Minor | The runbook's example files (`backups/*.csv`, `restore.sql`, `before-restore.sql`) sit in the repository and are not ignored, so `git add -A` commits the whole ledger | Verified |
| Minor | `setup verify` passes right after `webhook` even when the path or secret is wrong, because no delivery has happened yet (`scripts/setup.mjs:186`) | Verified by tracing |
| Minor | `.dev.vars` is parsed differently from Wrangler: comments, `export` and quotes with a trailing comment are read literally (`scripts/lib/secrets-file.mjs:6`). Every mismatch fails loudly | Verified |

Nits: members are not restored, so a former member shows as a numeric id; a NUL character in a description would break the whole restore; `/export 0000-02` is accepted; the formula guard omits a leading tab.

### Setup guide and config

| Severity | Defect |
|---|---|
| Major | `npx wrangler d1 create expense-bot` is interactive and its defaults add a second binding, leaving `DB` on the placeholder (`docs/setup.md:58`). Use `--binding DB` |
| Major | `wrangler secret put` before the first deploy asks whether to create the Worker; answering `n` makes the deploy fail on `secrets.required` with a message that contradicts the guide (`docs/setup.md:96`). Use `wrangler deploy --secrets-file .dev.vars` |
| Major | "The JSON line, written as a JSON string" has no example (`docs/setup.md:79`). Unescaped quotes break the config file; a bare object works at runtime but fails `npm run typecheck` |
| Major | The guide's optional settings are pinned by the tests: `scripts/wrangler-config.test.mjs:19` asserts `NUDGE_ENABLED` and `NUDGE_HOUR`, and `test/backup.test.ts:259` asserts `BACKUP_CHAT_ID` is unset. Following the guide's table breaks `npm test`. The same script strips only whole-line comments, so an end-of-line comment or trailing comma also breaks it |
| Minor | The paragraph on invalid settings is wrong in three cases: a wrong `WEBHOOK_SECRET` gives 401 with no log, an invalid `NUDGE_*` stops the Worker starting, and an invalid `BACKUP_CHAT_ID` only fails the backup job (`docs/setup.md:103`) |
| Minor | `BACKUP_CHAT_ID` has no stated format; for a private chat the member must first press Start on the bot (`docs/setup.md:84`) |
| Minor | No mention of the `workers.dev` subdomain prompt, the command menu, the `/ping` job lines, or any diagnostic query |
| Minor | Local development is undocumented beyond `db:migrate:local`. With the production token and the real chat id in the local database, local runs post to the real group; use a second bot |

Nits: "once expense capture exists" is stale; no `engines` field in `package.json`; `npm audit` reports 4 advisories in dev tooling only (`undici` under Wrangler; fixed in Wrangler 4.144 and later), and 0 in production dependencies.

## Operating risks

- **No alerting.** A failure shows only as a missing confirmation, a line in `/ping`, `setup verify`, or the Workers logs, which the free plan keeps for 3 days. Error text is stored only in the `last_error` columns of `updates` and `job_runs`.
- **Telegram keeps undelivered updates for 24 hours.** A longer outage or broken config loses the messages sent meanwhile.
- **The `updates` table keeps the raw JSON of every accepted update forever**, including message text. It is small, is not in the backup, and is never pruned.
- **`wrangler.jsonc` commits member user ids, the bot identity and the database id.** None is a secret, but keep it in mind before making the repository public. The group chat id lives only in the database.
- **Free-plan limits other than CPU are comfortable:** one cron trigger of five, well under 100,000 requests a day, and about 30 database statements on the busiest tick against a limit of 50.

## Not built

Nothing the epic requires for first use is missing. EB-13, the LLM fallback for messages the parser cannot read, is optional and not built. The epic's exit criteria still open are: all changes archived, 7 days of logging by both members, and one restore drill.
