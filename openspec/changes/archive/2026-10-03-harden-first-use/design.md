## Context

See proposal.md for the motivation. The findings and their evidence are in `docs/telegram-readiness.md`. This change was implemented in the same session as it was written, so the decisions below describe code that exists. Decisions 1 to 11 are the first round. Decisions 12 to 20 are the second round, which did the rest of the review's "Fix before real use" list on the same day, before anything was committed or archived. The second round extends this change instead of opening a new one: fix 9 changes a scenario inside "Entry date", which this change already modifies, and two open changes that modify one requirement conflict when they are archived.

No questions were asked: the user's instruction was to decide. Each decision carries its evidence and the alternative that was rejected.

Constraints:

- **The parser stays pure and linear.** It reads only the text, the time and the timezone (`expense-parsing`, "Parser contract"). Anything that needs the message's metadata belongs to capture.
- **Free plan.** 10 ms of CPU per request and per cron run. Cloudflare's limits page says that waiting on the database does not count, and that "each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit".
- **Telegram.** A press on an old message carries only the chat and the message id of that message (`InaccessibleMessage`), so a check on a press can rely on nothing else.

## Goals / Non-Goals

**Goals:**

- Remove the chat messages the review showed being logged, without stopping any expense form the spec already promises.
- Make a stale button harmless whatever happened to the rows.
- Make a failed backup visible in the group.
- Make the first deploy work when the guide is followed literally.
- Second round: no update parked by a deleted message, a late press or a short rate limit; a digest that survives a short outage; a reason for every failure; a backup whose loss is never silent and whose restore needs only recent files.

**Non-Goals:**

- Telling every sentence from an expense. That needs the optional LLM fallback (EB-13) or a confirm-before-log step, and both are larger changes.

## Decisions

### Decision 1: A rule-based gate, not an explicit trigger

The parser gains rules for the number shapes that ordinary chat holds, and capture ignores forwards. The alternatives were to require a trigger (a command, a mention or a currency mark on every amount), or to ask before logging a doubtful message.

- A trigger ends "type it the way you say it", which is the reason the bot exists (epic, EB-02).
- Asking first needs a store for pending items and a second message per doubt. It is a feature, not a fix.
- The review ran the parser on real examples. Every Major example except two is a number in a recognizable position: after `at`, after `otp`, in a phone number, after a month and day, behind a `+`. Rules for those positions are cheap, testable and silent when they do not apply.

What stays logged: a bare number that looks exactly like an amount (`bring 2 chairs`, `ay mali, 300 pala`, a shopping list with quantities). Every such entry still posts a confirmation with Undo. The README says so.

### Decision 2: The rules

All of them apply to a **plain number** only: a word made of the digits 0 to 9 and nothing else. A number with a currency mark, a thousands separator, a decimal part or the suffix `k` is written as money and is always read. This keeps `tickets at ₱500` and `bought at 1,500` working.

| Rule | Not an amount | Example | Where |
|---|---|---|---|
| Word before | A plain number directly after `at`, `alas`, `otp`, `pin`, `code`, `ref`, `reference`, `no`, `number`, `acct`, `account` or `year`, or after one of them and one linking word (`is`, or a word of only dashes or colons) | `see you at 7`, `otp is 123456`, `Happy New Year 2026!` | `src/parser/index.ts` |
| Leading zero | A plain number of two or more digits that starts with `0` | `room 007`, `0917` | `src/parser/amounts.ts` |
| Digit group | Plain numbers in a row, when the row is three or more long or holds one with a leading zero | `0917 123 4567`, `1234 5678 9012 3456` | `src/parser/index.ts` |
| Plus sign | A `+` that starts a word and is joined to a digit is part of the word, not a separator | `+1`, `+63 917 123 4567` | `src/parser/words.ts` |

Choices inside the rules:

- **The word list is short on purpose.** `for`, `in` and `mga` were left out: `dinner for 2 600` is a spec scenario, and `mga 250` is a natural way to give an approximate amount. `at` costs `shoes at 1500`, which is unusual next to `shoes 1500`, and `at ₱1500` still works.
- **Two plain numbers in a row are not a group**, so `dinner for 2 600` keeps its flag and its amount.
- **`0` alone is not a leading zero**, so `lunch 0` is still rejected as out of range.

### Decision 3: `may` and `jan` name a month only after a day number

`may` ("there is") and `jan` ("there") are everyday Tagalog words, and the household writes Taglish. `may 2 kape 300` was dated May 2. Now `may` and `jan` at the start of a date are ordinary words; `2 may`, `2 jan` and `january 2` are still dates.

The cost: an English `jan 2 rent 12000` is no longer backdated. It is logged for today and flagged `⚠️ check amount`, because the message then holds two numbers, so the member sees it. The alternative, guessing from the other words, has no reliable signal.

### Decision 4: A year after a month and day belongs to the date

`lunch 250 oct 3 2026` stored ₱2,026. Now a four-digit number directly after a month and day, or after one comma there, is the year when it is this year, the year before or the year after. The date is then exact: it is not moved to the nearest year, and the usual `invalid_date` and `future_date` rejections apply.

The range is three years on purpose. `sep 27 2000 meralco` must stay ₱2,000: amount-first messages are supported, and ₱2,000 is a common amount. Only ₱2,025, ₱2,026 and ₱2,027 collide, and only right after a month and day. An older date is written as `2024-12-30`.

### Decision 5: Forwards and via-bot messages are a capture rule

`forward_origin` and `via_bot` are fields of the message, not of its text, so the check is the first step of `handleCapture`. This also stops a forwarded bot confirmation from being logged again. A reply to another message is still captured: answering "how much was lunch" with `lunch 250` is a real entry.

### Decision 6: A press must come from the entry's confirmation

Entry ids come from SQLite's rowid without `AUTOINCREMENT`, so an id is used again after rows are lost. The handler now checks, after it reads the entry and before it changes anything:

1. the pressed message is in the entry's chat, and
2. its message id equals the entry's `confirmation_message_id`.

When the entry has no stored confirmation id (saving it failed, D37 of the capture design), the pressed message must instead be a reply to the entry's source message. Anything else is answered with the stale-button notice.

Alternatives rejected: adding `AUTOINCREMENT` needs a table rebuild and still fails after a wipe, because the counter goes with the rows. Putting the source message id into the button data would break every button already posted.

Only confirmations carry entry buttons (`/undo` replies have none), so no other message needs to pass the check. A backup holds `confirmation_message_id`, so after a restore the old buttons work again on the right entries.

### Decision 7: The scheduler alerts, on a later tick, for jobs that ask

A failed run is retried each hour inside the 3-hour window and then left. The alert is sent by the first tick after the window, from the stored run record, not by the failing attempt:

- An attempt cannot know it is the last one, and an attempt that is stopped by the CPU limit runs no more code. A later tick sees both `failed` and an interrupted `running` record.
- The alert goes through `sendOnce` with the part `failure_alert`, so it is sent at most once per scheduled date, and a failed send is tried again on the next tick. No migration is needed.
- It is sent to the group, not to `BACKUP_CHAT_ID`, which may be the thing that is broken, and with `disable_notification`, because the first tick after a 23:00 backup's window is 03:00.

A job opts in with `alertOnFailure: true`. Only `nightly_backup` does: a lost backup is the one silent failure that costs data. A `skipped` run does not alert, because the first deploy always records a skip for each job and that would be a false alarm.

Cost: while a failed run is the job's latest, each tick reads the chat id and the send record, two statements, against a limit of 50.

### Decision 8: Stay on the Free plan and limit `/export all` to 1,500 entries

Measured on this laptop in Node, reading and encoding rows as the Worker does (JSON parse of the rows, mapping, CSV, UTF-8):

| Rows | CPU, best of 30 |
|---|---|
| 500 | 2.1 ms |
| 2,000 | 8.7 ms |
| 5,000 | 22.8 ms |

About 4.4 µs per row, half of it parsing the database result. This agrees with the review's 9.7 ms for 2,000 rows. A household logging 5 to 8 entries a day reaches 1,500 in six to ten months, so the paid plan ($5 a month) is not needed now.

What the limit is for: a Worker that passes its CPU limit is stopped. The update then fails three times and is parked, and the member gets no reply. `/export all` now counts first (one cheap statement) and above `EXPORT_ALL_MAX_ENTRIES` answers with a text that names `/export <month>`. 1,500 rows cost about 6.5 ms and leave room for the rest of the request.

The limit applies to `all` only. A month never holds that many entries, and the nightly backup covers two months. Alternatives rejected: building the CSV in SQL moves the cost to the database but duplicates the cell encoder; splitting `all` into several files does not help, because one request still builds them all.

The number is not measured on Workers. It is a constant, to be raised after a move to the paid plan.

### Decision 9: Tests do not read the household's settings

`wrangler.jsonc` is both the test configuration and the household's settings, so a documented setting change broke `npm test`. Three fixes: the nudge settings are pinned in the Vitest bindings, which override the file; the backup tests build their environment without `BACKUP_CHAT_ID`; the config test parses JSONC properly (`scripts/lib/jsonc.mjs`) and asserts only the cron trigger and the database binding. Verified by running the whole suite with `NUDGE_ENABLED=false`, `NUDGE_HOUR=20`, a `BACKUP_CHAT_ID`, a trailing comma and a comment in the file.

### Decision 10: The guide follows what Wrangler 4.143.0 does

- `wrangler d1 create expense-bot --binding DB` writes the id into the existing `DB` entry without a prompt. Read in Wrangler's source (`createdResourceConfig`): a given binding name skips the prompts, and an entry with the same binding name is merged, so `migrations_dir` is kept.
- `wrangler deploy --secrets-file .dev.vars` uploads the secrets with the first version (`wrangler deploy --help`).
- `bot-info --escaped` prints the identity as a JSON string. The plain step is unchanged, so the spec's "one line of JSON" still holds.

None of these was run against a real Cloudflare account.

### Decision 11: Restore a lost database before the deploy

The deployed Worker keeps pointing at the lost database until the next deploy, and answers 503 meanwhile, so Telegram keeps the messages. The order is: create, migrate, apply `restore.sql`, check, store the chat id, deploy. Entries that arrive after the deploy take ids above the restored ones.

### Decision 12: Command replies allow sending without the command message

`/ping`, `/help`, the three reports, `/export` and `/undo` replied with `reply_parameters: { message_id }` only. Telegram refuses such a reply when the message is gone, so the attempt failed, every retry failed the same way, and the update was parked. For `/undo` the entry was already removed, so the member saw no answer to a change that had happened. Capture already set `allow_sending_without_reply` (`src/capture/index.ts`, D52 of the capture design); the four other reply helpers now do the same.

Rejected: catching the 400 and dropping the reply. The member would get nothing, and the reply is still useful without the reference.

### Decision 13: A press with no handler is answered through `answerPress`

The gateway's own stale-button answer (`src/gateway/bot.ts`) called `ctx.answerCallbackQuery` directly. A press delivered after Telegram's answer window gets `400 query is too old`, which failed the attempt three times and parked the update. `answerPress` (`src/telegram/inplace.ts`) already catches every error and logs `callback_answer_failed`, and the module's header says it is the only code that answers a press. The gateway now uses it.

### Decision 14: Every Telegram call times out after 20 s and waits out one short 429

Evidence, from grammY 1.46.0:

- The default `timeoutSeconds` is 500 (`out/core/client.js`), longer than the gateway's 120-second update lease. A hung call could let a redelivery run the handlers twice.
- The timer is set inside the base call, so each call through a transformer, including a repeated one, gets its own 20 seconds.
- A transformer sees Telegram's error answer as a resolved value, with `parameters.retry_after`; grammY throws only after the transformers return.
- An `InputFile` made from a `Uint8Array` can be sent again, so repeating an upload is safe. Export and backup build theirs that way.

`src/telegram/client.ts` holds the client options and the transformer, and both the gateway's `Bot` and the scheduler's `Api` install them. A 429 is waited out only when `retry_after` is present and at most 10 seconds, and only once. Worst case for one call: 20 + 10 + 20 = 50 seconds, so a handler that makes two calls in a row, such as a press (edit, then answer), ends inside the lease. A 429 without `retry_after`, a longer one, or a second one, fails the call as before, which keeps the `entry-corrections` rule that a rate-limited edit fails the attempt.

Rejected: `@grammyjs/auto-retry`. It is a new dependency, and by default it retries server errors and long waits, which could hold a request past the lease.

### Decision 15: Among unmarked numbers, one written as money wins, else the largest

The review ran `grab 180 (2 rides)` → ₱2 and `Paid 1,500 for 3 shirts` → ₱3. Next to a price, a quantity is usually the smaller number, and a separator, decimals or `k` mark a price. The rule applies only when no number carries a currency mark, so every marked case keeps its scenario. Amounts out of range rank below every amount in range, so `dinner for 0 600` and `0 days ago lunch 250` keep their results. Equal amounts go to the last, so `250 lunch 250` is unchanged. The `ambiguous_amount` flag stays: the choice is still a guess, and the confirmation shows it.

"Formatted" is computed in `chooseAmount` from the word (`!PLAIN_NUMBER.test(word)`), with no change to `AmountReading`, so the amount reader and its tests are untouched.

One scenario changed: `10000 days ago lunch 250` would now choose ₱10,000. The scenario is about the date, so its message became `10000 days ago lunch ₱250`.

Rejected: the first number (breaks `2 shirts 1500`); dropping the flag when a formatted number wins (a wrong guess would then be silent).

### Decision 16: Each job gives its own catch-up window

`JobRegistration` gains an optional `catchUpHours`, 3 when absent. The values:

| Job | Window | Why |
|---|---|---|
| `weekly_digest` | 24 h | A digest read on Monday evening is still useful |
| `monthly_recap` | 48 h | The same, for a month |
| `evening_nudge` | 2 h | At hour 21 it now stops at 23:00, not after midnight |
| `nightly_backup` | 3 h | Its alert comes from the first tick after the window, at 03:00; the next night's file covers the same window anyway |

Validation refuses a window that is not a whole number from 1 to the period minus one hour: 23 for a daily job, 167 for a weekly one, 671 for a monthly one, because the shortest month has 672 hours. A longer window would never be used, because the latest slot moves on first.

A nudge hour of 22 or 23 can still nudge after midnight, within 2 hours; the readiness review lists that separately.

### Decision 17: A skipped run alerts when the job has run before

`decide` treated `skipped` as finished, so a backup with no tick in its window was lost silently. Every first deploy records a skip for each job, so a skip alone cannot alert. The pre-read (`findRuns`) now also returns, through an `EXISTS` subquery in the same statement, whether the job has a record for an earlier date. A skip with an earlier record alerts on the next tick, through the same `failure_alert` send record, with its own text.

The alert says only that the latest slot was skipped. When ticks stop for days, the dates in between get no record. The monthly snapshot (Decision 18) and the two-month entries file cover that.

### Decision 18: The monthly snapshot is one part a night

A restore needed the last file of every month back to the start of the ledger, so a missing month or an auto-delete timer lost data. One file of every entry would pass the 10 ms CPU limit once the ledger passes about 2,000 entries (Decision 8). So the whole ledger goes out over the first nights of each month: part *n* on night *n*, ids (*n* − 1) × 1000 + 1 to *n* × 1000.

- Entries are never deleted (there is no `DELETE FROM expenses` anywhere), so the ids from 1 to the greatest id are every entry, and the parts together are the whole ledger.
- A part is consistent with the newest entries file: that file holds every change since the first day of the month before, which is never later than when any part's newest copy was made. A restore takes each part's newest file, then the newest entries and keywords files.
- A part is about 4.4 ms of CPU. It goes last, through its own send record, so a run that the CPU limit stops is repeated with only the part left to build.
- Nights 1 to 28 cover 28,000 entries, about ten years at eight entries a day.

Rejected: a separate snapshot job (one more `/ping` line and alert for the same files); one part per tick of one day (needs a scheduler outcome for "not finished", which means a migration of the `job_runs` status check).

### Decision 19: `/ping` shows the reason, the logs a code

`/ping` adds the first line of `last_error`, cut to 60 characters, to a `failed` line. `/ping` answers only in the household's group, so the text stays with the people whose ledger it may describe. The logs keep the rule that no entry holds an error message, because an error can carry ledger content and Cloudflare's logs are a different audience. They get a code instead: `telegram_<code>`, `telegram_unreachable`, `database` or `other` (`src/gateway/failure.ts`), on `attempt_failed` and `job_failed`.

### Decision 20: The runbook and the guide

- **Time Travel.** `wrangler d1 time-travel info` and `restore` (checked against Wrangler 4.143.0's help) bring every table back to a point in the last 7 days on the Free plan. It is the first choice after a bad change; the files are for a lost database or anything older.
- **Missing entries.** `SELECT MAX(id) - COUNT(*) FROM expenses` is 0 exactly when no id is missing, because ids have no gaps (Decision 18). It goes into "Check the result".
- **Local development.** `docs/setup.md` now says what `README.md` already said: use a second bot, because local runs with the production token and the real chat id post to the household group. A `##` heading would break `scripts/guide.test.mjs`, so it is a paragraph in the database section.

None of the Wrangler commands was run against a real account.

## Risks / Trade-offs

- **The gate has false negatives.** `shoes at 1500`, `jan 2 rent 12000` and `sep 27 2026` as an amount are read differently than before. Each is either flagged in a confirmation or gets no confirmation at all, and the member can resend with a mark. → README and the spec scenarios document the forms.
- **The gate is not complete.** → Stated in the README, the readiness review and the non-goals.
- **A confirmation whose id was never saved and whose source message was deleted has dead buttons.** Both faults must happen to one entry. → `/undo` still removes the sender's latest entry.
- **The 1,500 limit is a laptop measurement.** → A constant with its evidence next to it.
- **The alert depends on a later tick.** If the cron trigger stops, nothing alerts. → `/ping` and `setup verify` remain the checks for that. A skip alerts once ticks resume (Decision 17).
- **A call can take 50 seconds.** A handler with three slow calls could still outlast the 120-second lease. → Each call's worst case fell from 500 s to 50 s.
- **The largest number can be wrong.** `paid 500 change 20` is right, but a quantity larger than its price is not. → The flag stays on every such choice.
- **A first deploy can send an empty digest.** Within 24 hours after Sunday 19:00, or 48 hours after the 1st at 08:00, the first tick runs the digest or recap for a period with no entries, instead of skipping it. → Harmless, and it shows that the jobs work.
- **The snapshot stops at 28,000 entries.** → `SNAPSHOT_PART_SIZE` in `src/export/backup.ts` can be raised after a move to the paid plan.

## Migration Plan

No migration and no setting. Deploy as usual. Buttons already posted keep working, because they sit on their entries' confirmations. The first complete snapshot is the one that starts on the next 1st; until then, a restore needs the files of every month, as before.

## Open Questions

None.
