## Context

See proposal.md for the motivation. This change builds the six remaining MVP issues of `docs/epic.md` (EB-06, 07, 08, 10, 11, 12) on top of four archived changes. What exists today:

- **Gateway.** A feature module registers commands, button prefixes, message handlers, edited-message handlers, jobs and a status function (src/gateway/registry.ts:3-11). A press is routed by the text before its first colon (src/gateway/bot.ts:43-55). A handler that throws fails the attempt, and Telegram redelivers the update up to 3 times (src/gateway/update-log.ts:3-5). Every handler therefore has to be safe to run again.
- **Capture.** `handleCapture` parses, categorizes, stores and confirms (src/capture/index.ts:13-79). The confirmation text comes from `confirmationText(entries, payerName, sentOn)` (src/capture/format.ts:46-66). Capture must stay the last message handler (openspec/specs/expense-capture/spec.md, "Capture is registered").
- **Ledger.** `softDeleteEntry`, `restoreEntry` and `setEntryCategory` are guarded updates that report `changed`, `unchanged` or `not_found` (src/ledger/index.ts:206-257). `findLatestActiveEntry`, `totalsByCategory`, `listEntries` and `countActiveEntriesOn` exist. There is no find-by-id. The archived capture design left that to EB-06 (archive/2026-10-02-add-expense-capture/decisions.md, D21).
- **Categorization.** `keyword_map` exists and is read by `listKeywords`. Nothing writes it (migrations/0003_categorization.sql; src/categories/store.ts).
- **Scheduler.** One hourly tick runs each due job with a `JobContext` that carries `scheduledDate` (src/scheduler/index.ts:153-161). It runs a job at least once per scheduled date, so a job must be safe to repeat (archive/2026-10-02-add-job-scheduler/decisions.md, D12). No job is registered yet.

Constraints that shape the design:

- **Free-plan limits.** 10 ms of CPU per request and per cron run, and 50 D1 statements per invocation (docs/epic.md:153-155).
- **Epic rules.** One message in, at most one bot message out, and later changes edit that message in place. No typed answers. Totals in code or SQL. Nothing is hard-deleted. Household totals only. Customization in config files (docs/epic.md:101-111).
- **Telegram.** Button data is at most 64 bytes. Every press must be answered. Editing a message to the text and buttons it already has is refused with a 400 `message is not modified`. Plain text has no strikethrough.
- **Store style.** A store is a plain function over `D1Database` that takes `now` as an argument and makes a write idempotent with `ON CONFLICT` or a guarded `UPDATE`, not by catching an error (src/gateway/update-log.ts:44-83).

No explore brief exists for this change. Discovery was done while the artifacts were written, and the user's standing instruction is to decide and record instead of asking. Each decision below carries its reason and the alternative that was rejected.

## Goals / Non-Goals

**Goals:**

- One definition of a confirmation, used by every code path that sends or edits one.
- Every handler and job safe to run again: a repeated update applies no correction twice, and a repeated job run sends no message twice.
- Pure functions for everything that formats or computes (the renderer, the report builder, the periods, the CSV encoder), so most scenarios are plain unit tests.
- No gateway behavior change and no new dependency.

**Non-Goals:**

- A general "outbox" or retry queue. The send record covers only "this job already sent this part for this date".
- Conversation state. The category grid lives only in the message's own buttons.
- Raising `keyword_map.hit_count`. Nothing in the MVP reads it (Decision 10).
- A timezone-exact backup window. The window is a superset by design (Decision 16).

## Decisions

### Decision 1: Scope, order and one migration

The change holds EB-06, EB-07, EB-08, EB-10, EB-11 and EB-12. EB-13 is left out: it is optional, the epic's exit criteria name EB-01 to EB-12 only (docs/epic.md:723), and it needs a new SDK and an API key.

Build order inside the change follows the epic's dependency graph (docs/epic.md:163-177):

```
foundations   migration 0005 · ledger additions · categorization additions · send record
              confirmation renderer · CSV encoder · report builder · periods · in-place edit helper
features      corrections + learning (EB-06, EB-07)   needs renderer, ledger, categorization
              report commands (EB-08)                 needs report builder
              digests (EB-10)                         needs report builder, ledger, send record
              nudge (EB-11)                           needs ledger, send record
              export + backup + restore (EB-12)       needs CSV encoder, ledger, categorization, send record
wiring        src/modules.ts · wrangler.jsonc · docs · deployed-bot tests
```

The features touch separate directories, so they can be built in parallel once the foundations exist.

All schema changes go into one file, `migrations/0005_corrections_reports_jobs.sql`. The epic gave `0005` to EB-11 and `0006` to EB-13 (docs/epic.md:146). One file for one change keeps `0006` free for EB-13. Alternative rejected: one migration per issue. It would take `0006` and `0007` and leave EB-13 out of order.

### Decision 2: Layout and wiring

```
migrations/0005_corrections_reports_jobs.sql
src/config/schedule.ts        WEEKLY_DIGEST, MONTHLY_RECAP, NIGHTLY_BACKUP, DEFAULT_NUDGE_HOUR
src/capture/confirmation.ts   renderConfirmation, categoryGrid               (pure)
src/capture/format.ts         formatPesos, categoryLabel, dateLabel, shorten, rejectionText (existing home)
src/telegram/inplace.ts       editInPlace, showButtons, answerPress
src/corrections/data.ts       parsePress                                    (pure)
src/corrections/refresh.ts    refreshConfirmation, payerName
src/corrections/presses.ts    the handlers of c, s, u, r and b
src/corrections/undo.ts       the /undo handler
src/corrections/edited.ts     the edited-message handler
src/corrections/index.ts      the `corrections` module, which only assembles the registrations
src/categories/learn.ts       learnableKeyword                              (pure)
src/categories/store.ts       + teachKeyword, listKeywordRows
src/categories/lookup.ts      + countsAsSpending, NOT_COUNTED_IDS
src/ledger/index.ts           + getEntry, markSourceEdited, largestEntries, countDaysWithEntries,
                                listBackupEntries, findRemovalAt
src/reports/periods.ts        weekStart, monthStart, previousMonth, daysInMonth, shortDate,
                              rangeLabel, monthTitle                        (pure)
src/reports/build.ts          buildReport (pure), loadReport
src/reports/format.ts         formatReport                                  (pure)
src/reports/index.ts          the `reports` module: /today /week /month
src/scheduler/sends.ts        sendOnce
src/digests/index.ts          the `digests` module: weekly_digest, monthly_recap
src/digests/format.ts         weeklyDigestText, monthlyRecapText            (pure)
src/nudge/settings.ts         readNudgeSettings                             (pure)
src/nudge/store.ts            markNoSpending, isNoSpendingDay
src/nudge/index.ts            createNudge(settings): evening_nudge · n
src/export/csv.ts             csvCell, csvFile                              (pure)
src/export/files.ts           entriesCsv, keywordsCsv, column lists         (pure)
src/export/command.ts         the /export handler
src/export/backup.ts          the nightly_backup job, readBackupChatId
src/export/index.ts           the `export` module, which only assembles the registrations
src/gateway/members.ts        + listMembers
scripts/lib/backup-csv.mjs    parseCsv, decodeCell, toStatements            (pure)
scripts/restore.mjs           the command-line entry
docs/backup-restore.md
```

`src/modules.ts` becomes:

```ts
import { env } from "cloudflare:workers";

export const modules: FeatureModule[] = [
  core,
  scheduler,
  reports,
  corrections,
  digests,
  createNudge(readNudgeSettings(env)),
  exporter,
  capture, // stays last: it is the only message handler
];
```

This order gives `/help` the lines `/ping`, `/help`, `/today`, `/week`, `/month`, `/undo`, `/export`, and gives `/ping` and each tick the job order `weekly_digest`, `monthly_recap`, `evening_nudge`, `nightly_backup`. No new module registers a message handler, so capture stays the last one.

`formatPesos`, `categoryLabel` and `shorten` stay in `src/capture/format.ts` and are imported from there by reports, digests, corrections and export. Alternative rejected: moving them to a new shared directory. That would touch every capture import and test for no change in behavior. `shorten` becomes exported.

Job schedules that are not settings live in `src/config/schedule.ts`, following the epic's rule that the schedule is a config file (docs/epic.md:109).

### Decision 3: Migration 0005

```sql
ALTER TABLE expenses ADD COLUMN source_edited_at TEXT;
CREATE INDEX expenses_updated_at ON expenses (updated_at);
CREATE INDEX expenses_removed ON expenses (deleted_by, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE day_marks (
  date      TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  marked_by INTEGER NOT NULL,
  marked_at TEXT    NOT NULL
) STRICT;

CREATE TABLE job_sends (
  job            TEXT    NOT NULL CHECK (length(job) BETWEEN 1 AND 32),
  scheduled_date TEXT    NOT NULL CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  part           TEXT    NOT NULL CHECK (length(part) BETWEEN 1 AND 32),
  chat_id        INTEGER NOT NULL,
  message_id     INTEGER NOT NULL,
  sent_at        TEXT    NOT NULL,
  PRIMARY KEY (job, scheduled_date, part)
) STRICT;
```

- `source_edited_at` is nullable, so rows stored before the migration need no backfill.
- `expenses_updated_at` serves the backup window (Decision 16). `expenses_removed` serves `/undo`'s lookup of its own removal (Decision 8).
- `day_marks` has no `kind` column. The MVP has one kind of mark, and a column with one allowed value is noise.
- Tables follow the conventions of `0001`: `STRICT`, ISO-8601 UTC text, `CHECK` for formats, no triggers and no foreign keys.

### Decision 4: Ledger additions

`Entry` gains `sourceEditedAt: string | null`, mapped in `toEntry`. Six functions are added, each one statement or one batch, in the style of the existing ones:

| Function | Statement |
|---|---|
| `getEntry(db, id)` | `SELECT * FROM expenses WHERE id = ?`. Returns `null` without a statement when `id` is not a positive safe integer |
| `markSourceEdited(db, chatId, sourceMessageId, now)` | one batch: `UPDATE expenses SET source_edited_at = ?1 WHERE chat_id = ?2 AND source_message_id = ?3 AND source_edited_at IS NULL`, then the existing `SELECT_MESSAGE`. Returns the entries |
| `largestEntries(db, period, { limit, excludeCategoryIds })` | `… WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ? [AND category_id NOT IN (…)] ORDER BY amount_centavos DESC, spent_on, id LIMIT ?` |
| `countDaysWithEntries(db, period)` | `SELECT COUNT(DISTINCT spent_on) … WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ?` |
| `listBackupEntries(db, { datedFrom, changedSince })` | `SELECT * FROM expenses WHERE spent_on >= ?1 OR updated_at >= ?2 ORDER BY id` |
| `findRemovalAt(db, byUserId, at)` | `… WHERE deleted_by = ?1 AND deleted_at = ?2 ORDER BY id DESC LIMIT 1` |

Dates and the limit are validated before any statement is sent, with `RangeError`, as `checkPeriod` does today (src/ledger/index.ts:93-102). Marking does not touch `updated_at`, like `attachConfirmation`: it is bookkeeping about the message, not a member's change to the entry.

Alternative rejected for the edit mark: keeping no state and adding the notice line only in the edit handler. The next button press would rebuild the text and silently drop the line, and the edit would again look applied.

### Decision 5: One confirmation renderer

`src/capture/confirmation.ts` exports:

```ts
export interface ConfirmationView { text: string; keyboard: InlineKeyboardButton[][] }
export function renderConfirmation(entries: readonly Entry[], payerName: string, timezone: string): ConfirmationView;
export function categoryGrid(entryId: number): InlineKeyboardButton[][];
```

`renderConfirmation` implements the `expense-capture` requirement "The confirmation shows the current state of its entries" and replaces `confirmationText`. It is a pure function of its three arguments. The date word's base is computed inside it and nowhere else: `localDate(new Date(entries[0].createdAt), timezone)`.

**Why the base is the creation date.** A re-render has to give the same date word as the first confirmation. The send date is not stored, and the creation time is. Using the creation date for the first confirmation too gives one value for every reader. The cost is one visible change: a message sent at 23:59 and first handled after midnight is confirmed with `yesterday` instead of `today`. Alternatives rejected: a new `sent_on` column, which needs a backfill that SQL cannot do without knowing the household timezone, and a second base for re-renders, which makes the word flip from `today` to `yesterday` on the first tap.

**Removed entries are plain text.** `🗑 removed · …` needs no formatting mode, so text typed by members still shows exactly as typed (openspec/specs/expense-capture/spec.md, "One confirmation per message"). Alternative rejected: strikethrough through message entities. It works, but it adds offset bookkeeping to every render for a cosmetic gain.

**Buttons.** `keyboard` is a plain array of rows of `{ text, callback_data }`. The longest data is `s:<id>:<category id>`: 2 + at most 16 digits + 1 + at most 12 letters, well under 64 bytes. Category ids are 1 to 12 lower-case letters by the `categorization` spec, so they need no escaping.

**The payer name** is read by one helper, `payerName(db, userId)` in `src/corrections/refresh.ts`, which returns the member's display name or the user id as text. Capture passes `ctx.gateway.member.displayName`, which the gateway has just written to the same record, so both paths read the same value.

### Decision 6: Corrections handlers

`src/corrections/data.ts` holds the only parser of press data:

```ts
export type Press =
  | { kind: "c" | "u" | "r" | "b"; entryId: number }
  | { kind: "s"; entryId: number; categoryId: string };
export function parsePress(kind: "c" | "s" | "u" | "r" | "b", payload: string): Press | null;
```

An entry id matches `^[1-9][0-9]{0,15}$`. For `s`, the category id must pass `isCategoryId`. Anything else is `null`, which is answered with the gateway's `STALE_BUTTON_NOTICE`.

Every press follows one sequence, so the order of side effects is the same everywhere:

1. Parse the data. `null` → answer with the stale notice. Stop.
2. `getEntry`. `null` → answer with the stale notice. Stop.
3. Change the ledger: `softDeleteEntry` for `u`, `restoreEntry` for `r`, `setEntryCategory` with the source `manual` for `s`, nothing for `c` and `b`.
4. For `s`, when the entry is now active and holds the picked category: teach the keyword (Decision 10).
5. Set the message the button is on to the current state with `refreshConfirmation`, which runs `findEntriesBySourceMessage`, `payerName`, `renderConfirmation` and `editInPlace`. `/undo` and the edit handler call the same function. For `c` on an active entry, `showButtons` with `categoryGrid` instead.
6. Answer the press with the notice.

The message that is edited is always the one the button is on, taken from the press itself. That is the fallback the capture design planned for a confirmation whose id was not saved (archive/2026-10-02-add-expense-capture/design.md:478).

| Press | Ledger outcome | Notice |
|---|---|---|
| `u` | changed / unchanged | `Removed.` / `Already removed.` |
| `r` | changed / unchanged | `Restored.` / `Already active.` |
| `c` | entry active / removed | none / `This entry was removed.` |
| `b` | any | none |
| `s` | entry active and holds the category / entry removed | Decision 10 / `This entry was removed.` |

### Decision 7: In-place edits and answers

`src/telegram/inplace.ts` is the only code that edits a bot message or answers a press. Corrections and the nudge both use it.

```ts
export async function editInPlace(api: Api, target: { chatId: number; messageId: number }, view: { text: string; keyboard: InlineKeyboardButton[][] }, updateId: number): Promise<void>;
export async function showButtons(api: Api, target, keyboard, updateId: number): Promise<void>;
export async function answerPress(ctx: BotContext, text?: string): Promise<void>;
```

- A `GrammyError` with `error_code` 400 is swallowed. When its description does not contain `message is not modified`, one line `{ event: "edit_skipped", update_id }` is logged. A 400 is permanent: the message is already as asked, was deleted, or can no longer be edited. Failing the attempt would only park the update after three tries.
- Any other error is thrown. A 429, a 5xx or a network error is transient, and the gateway's retry repeats the handler. Step 3 of Decision 6 is a guarded update, so the repeat changes nothing in the ledger.
- `answerPress` catches every error and logs `{ event: "callback_answer_failed", update_id }`. On a retry the press is usually too old to answer, and that must not fail an attempt that did its work.
- Edits are sent with `link_preview_options: { is_disabled: true }` and no `parse_mode`, like the first confirmation.

### Decision 8: `/undo` is keyed by the command's send time

`/undo` picks "the latest active entry", which is a different entry after each removal. If the reply fails after the removal, the gateway runs the command again, and a naive handler would remove a second entry.

The handler therefore stamps the removal with the time the command was sent, `new Date(ctx.msg.date * 1000)`, which is the same on every attempt:

1. `findRemovalAt(db, member.userId, sentAt)`. Found → this command already removed that entry. Skip to step 4.
2. `findLatestActiveEntry`. None → reply `Nothing to undo.` Stop.
3. `softDeleteEntry` with `now: sentAt`. An outcome other than `changed` means a button removed the entry in the same moment → reply `Nothing to undo.` Stop.
4. When the entry has a confirmation message id, set that confirmation to its current state with `editInPlace`.
5. Reply `↩️ Removed …`.

Capture already uses the send time, not the attempt time, as the value that is stable across attempts (src/capture/index.ts:20-22). Alternative rejected: a table that maps a command message to the entry it removed. It is exact, but it is a table for one command. The cost of the chosen design is that two `/undo` commands from one member in the same second remove one entry. A member who taps `Undo` and sends `/undo` in the same second is not affected, because a button stamps the attempt time, with milliseconds.

### Decision 9: The edit notice

The edited-message handler:

1. Ignore an edit without text.
2. `findEntriesBySourceMessage(chatId, messageId)`. No entries → stop, silently.
3. The edited text equals `entries[0].rawText` → stop.
4. `markSourceEdited`.
5. When an entry has a confirmation message id: `renderConfirmation` and `editInPlace`. The renderer adds the notice line.

A second edit marks nothing new and renders the same text, which Telegram refuses as not modified, which Decision 7 swallows. The handler never sends a new message, which keeps the epic's rule 1.

### Decision 10: Learning

`learnableKeyword(description)` returns `normalizeKeyword(description)` when `normalizeWords(description)` has 1 to 3 words, else `null` (src/categories/normalize.ts). "Significant words" in the epic (docs/epic.md:459) is read as "the words left after normalization", which already drops punctuation and emoji. Alternative rejected: a stop-word list. It needs a second config file in two languages, and the gain is small: `lunch at jollibee` is 3 words either way.

`teachKeyword(db, { keyword, categoryId, taughtBy, now })` normalizes the keyword itself, rejects an empty result or an unknown category with `RangeError`, and runs one statement:

```sql
INSERT INTO keyword_map (keyword, category_id, source, taught_by, hit_count, created_at, updated_at)
VALUES (?1, ?2, 'learned', ?3, 0, ?4, ?4)
ON CONFLICT (keyword) DO UPDATE SET
  category_id = excluded.category_id, source = 'learned',
  taught_by = excluded.taught_by, updated_at = excluded.updated_at
WHERE keyword_map.category_id <> excluded.category_id OR keyword_map.source <> 'learned'
```

Teaching happens whenever, after the `s` press, the entry is active and holds the picked category, whether `setEntryCategory` reported `changed` or `unchanged`. A repeated attempt reports `unchanged`, and it must still teach when the first attempt failed between the two writes. The statement is idempotent, so teaching twice is harmless.

The notice is `<keyword>: <short name> from now on`, with the keyword shortened by `shorten`, or `Filed under <emoji> <short name>.` when nothing was learned.

`hit_count` is written as 0 and never raised. Raising it would add a write to every captured message, and no MVP feature reads it. The command that would read it, listing learned keywords, is deferred (docs/epic.md:737).

Capture needs no change to use learned keywords. It already builds its matcher from `listKeywords` for each message (src/capture/index.ts:34).

### Decision 11: Reports

```ts
export interface Report {
  totalCentavos: number;
  count: number;
  lines: { categoryId: string; totalCentavos: number; share: number }[];
  notCounted: { categoryId: string; totalCentavos: number }[];
  empty: boolean; // no active entry at all
}
export function buildReport(totals: readonly CategoryTotal[]): Report;
export async function loadReport(db: D1Database, period: Period): Promise<Report>;
export function formatReport(title: string, report: Report): string;
```

`loadReport` is one `totalsByCategory` call, which already orders rows by total and then by category id. `buildReport` splits the rows with `countsAsSpending(categoryId)`, a new helper in `src/categories/lookup.ts` that returns `true` for an id not in the list. A share is `Math.floor((200 * part + total) / (2 * total))`, which rounds a half up in integer arithmetic.

Report lines are `<category> · <total> · <share>`. The epic's sample pads the lines into columns (docs/epic.md:489-500). Telegram shows plain text in a proportional font, and emoji have their own widths, so padding does not line up. The ` · ` separator matches the confirmation.

"Today" for a command is `localDate(ctx.gateway.now, timezone)`. `/week` and `/month` cover the period up to today, and their title shows that range. The parser rejects future dates, so a to-date period and the full period have the same total.

A database failure in `loadReport` is not caught. The attempt fails and the gateway retries, as `/ping` does (src/core/index.ts:23).

### Decision 12: The send record

```ts
export interface SendKey { job: string; scheduledDate: string; part: string }
export async function sendOnce(
  db: D1Database, key: SendKey, now: Date,
  send: () => Promise<{ chat: { id: number }; message_id: number } | null>,
): Promise<"sent" | "already_sent" | "nothing_to_send">;
```

1. `SELECT 1 FROM job_sends WHERE job = ? AND scheduled_date = ? AND part = ?`. A row → `already_sent`.
2. `await send()`. An error passes on. `null` → `nothing_to_send`, and no record is written.
3. `INSERT INTO job_sends … ON CONFLICT DO NOTHING`. A failure is caught and logged as `{ event: "job_send_unsaved", job, scheduled_date, part }`.

The job builds its message inside `send`, so a run that already sent does no ledger reads. `null` lets the nudge decide inside the callback that there is nothing to send.

The record lives with the scheduler because the scheduler's at-least-once rule is what makes it necessary. Alternative rejected: a column on `job_runs`. A job sends several parts, and a job does not own its run record.

What is left uncovered: a Worker that is killed between the send and step 3 sends again on the next run. Capture accepts the same window for the same reason, that a missing message costs more than a repeated one (openspec/specs/expense-capture/spec.md, "Repeating an update is safe").

### Decision 13: Digests

Both jobs take every date from `job.scheduledDate`, never from `job.now`, as the scheduler requires (src/gateway/registry.ts:44-49).

- **`weekly_digest`**, `{ every: "week", weekday: 7, hour: 19 }`. The week is `shiftDate(scheduledDate, -6)` to `scheduledDate`. It makes two `loadReport` calls: the week, and `monthStart(scheduledDate)` to `scheduledDate` for the month-to-date line. The part is `digest`.
- **`monthly_recap`**, `{ every: "month", day: 1, hour: 8 }`. The month is `previousMonth(scheduledDate)`. It calls `loadReport`, `largestEntries` with the limit 5 and `NOT_COUNTED_IDS` left out, and `countDaysWithEntries`. The part is `recap`. The daily average is `Math.floor((2 * total + 100 * days) / (200 * days))` whole pesos, formatted with `formatPesos`.

`weeklyDigestText` and `monthlyRecapText` are pure and reuse `formatReport`. Messages are sent with `job.api.sendMessage(job.chatId, text, { link_preview_options: { is_disabled: true } })`.

### Decision 14: The nudge

**Settings are read at module scope.** A job's schedule is part of its registration, and the registry is built when the Worker starts, before any request brings an `env`. `src/modules.ts` therefore reads `env` from `cloudflare:workers`, which the runtime exposes at module scope (worker-configuration.d.ts:14353), and passes the result of `readNudgeSettings(env)` to `createNudge`. `readNudgeSettings` is a pure function over a record. It throws `RegistrationError` naming the setting, so a bad value fails the deploy the same way an invalid schedule does. Alternative rejected: a schedule that is a function of `env`. It would change the scheduler's contract and move validation from startup to the first tick.

`wrangler.jsonc` gains `"NUDGE_ENABLED": "true"` and `"NUDGE_HOUR": "21"` under `vars`.

**The job.** `evening_nudge`, `{ every: "day", hour }`. It runs `sendOnce` with the part `nudge`. Inside the callback: `countActiveEntriesOn(scheduledDate) > 0` or `isNoSpendingDay(scheduledDate)` → `null`. Otherwise it sends the text with one button, `n:<scheduledDate>`. The text names the date, not "today", so a run that is 3 hours late and lands after midnight still reads correctly.

**The press.** `n:<date>` is validated with a `YYYY-MM-DD` pattern and `isRealDate` (src/parser/dates.ts:28). Then: `countActiveEntriesOn(date) > 0` → edit to `👍 <date> has entries now.` Otherwise `markNoSpending` (`INSERT … ON CONFLICT (date) DO NOTHING`) and edit to `✅ No spending on <date>.` Both edits pass an empty keyboard. The press uses `editInPlace` and `answerPress` (Decision 7).

When the nudge is disabled, `createNudge` registers the `n` prefix and no job.

### Decision 15: CSV files and `/export`

`csvCell(value)` is the only encoder: `null` → empty, a number → its digits, then the `'` prefix for a first character in `=+-@'`, then quoting. `csvFile(header, rows)` joins cells with `,` and ends every row with `\r\n`. The amount is `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`.

`'` is in the list so the prefix can be undone: the restore script takes one `'` off any cell that starts with one. Without it, a description that really starts with `'=` could not be told from a neutralized `=`.

There is no byte-order mark. The spec says UTF-8 with standard quoting, and descriptions are mostly ASCII. `docs/backup-restore.md` notes how to import the file as UTF-8 in Excel.

`entriesCsv(entries, { names, full })` writes the 11 export columns, plus the 13 restore columns when `full` is true. `names` is a `Map<number, string>` built from `listMembers(db)`, a new read in `src/gateway/members.ts`.

Files are sent with `new InputFile(new TextEncoder().encode(csv), fileName)` from grammY `1.46.0`, which is already pinned. In the Workers build, grammY sends a multipart body as a stream (node_modules/grammy/out/web.mjs:2645-2658).

`/export` uses `listEntries` for a month, and `listEntries` with the period `0001-01-01` to `9999-12-31` for `all`. Its argument is trimmed and lower-cased once, then matched against `""`, `all` and `^\d{4}-(0[1-9]|1[0-2])$`.

### Decision 16: The nightly backup

`nightly_backup`, `{ every: "day", hour: 23 }`. Let `first = previousMonth(scheduledDate).from`, which is the first day of the previous month. The entries file is `listBackupEntries(db, { datedFrom: first, changedSince: first + "T00:00:00.000Z" })`.

**Why two conditions.** Selecting by spent-on date alone matches the epic's words, "the current and previous month" (docs/epic.md:603). It would miss an entry typed today for a date three months ago, and a correction made today to an old entry. Those rows would be in no backup file. Adding "or changed since the month before began" puts every row into the backups of the nights after it was written or changed, so the files together hold the whole ledger. The time is compared in UTC, which is a superset of the household month by a few hours. That needs no timezone arithmetic, and extra rows in a backup are harmless.

**The backup chat** is `readBackupChatId(job.env, job.chatId)`, read at run time, so a bad value shows up as a failed run in `/ping`.

**Two parts.** `entries` and `keywords`, each through `sendOnce`, with `disable_notification: true`. When the second send fails, the retry skips the first.

**Size.** Two months at 10 entries a day is about 600 rows of about 250 bytes, about 150 KB, built with string concatenation. That is well inside the CPU limit. `/export all` grows with the ledger and is on demand, as the epic accepts (docs/epic.md:618).

### Decision 17: The restore script

`scripts/lib/backup-csv.mjs` is pure: `parseCsv(text)` reads the format of Decision 15, `decodeCell(cell)` takes one leading `'` off, and `toStatements(fileName, text)` returns SQL or throws for a header that is not one of the two backup headers. `scripts/restore.mjs` reads the files named on the command line, validates all of them before printing anything, and prints one `INSERT OR REPLACE` per row. Text is written as a SQL literal with `'` doubled. An empty cell becomes `NULL` for `confirmation_message_id`, `deleted_at`, `deleted_by`, `source_edited_at` and `taught_by`, and an empty text for `description`. `package.json` gains `"restore": "node scripts/restore.mjs"`.

`INSERT OR REPLACE` with the original id makes the script safe to run twice, and makes the file given last win. The script prints SQL and applies nothing, so "automatic restore" stays out of scope (docs/epic.md:616). The member applies the output with `wrangler d1 execute --file`.

The script is plain `.mjs`, like `scripts/setup.mjs`, so it runs without a build. It does not import the TypeScript encoder. The two are pinned to each other by tests that use the same literal rows from the `data-export` spec.

### Decision 18: Tests

- **Pure functions** get table-driven unit tests under `test/unit/`: the renderer, `parsePress`, `learnableKeyword`, `buildReport`, `formatReport`, the periods, the digest texts, `readNudgeSettings`, `csvCell` and the file builders.
- **Stores** are tested against `env.DB`: the six ledger functions, `teachKeyword`, `listKeywordRows`, `sendOnce`, the `day_marks` store, and one test for each `CHECK` of migration `0005`.
- **Handlers** are tested through `createGateway({ modules, now })` with `signedRequest`, `callbackUpdate` and `editedMessageUpdate`, and the Telegram stub. **Jobs** are tested through `createScheduler` and `tick`. One test per scenario, named after it, inside a `describe` named after its requirement, as the archived changes do.
- **`test/helpers/telegram.ts`** learns to read a multipart body. When the request's `content-type` is `multipart/form-data`, the payload becomes `{ fields: Record<string, string>, files: { field: string; fileName: string; text: string }[] }`, read with `new Response(init.body).text()` and split at the boundary. `failNext` already gives an injected error for any method, including a 400 for `editMessageText`.
- **`test/helpers/updates.ts`**: `callbackUpdate` already takes `data` and `messageId`. `editedMessageUpdate` already exists.
- **Restore** is tested with `node --test` in `scripts/restore.test.mjs`. It applies the five migration files and the script's output to an in-memory database from `node:sqlite`, which Node 24 provides (the project requires Node 24, docs/setup.md:5), and compares the rows.
- **Existing tests that change.** `test/unit/capture-format.test.ts` (the renderer replaces `confirmationText`, and `Entry` literals gain `sourceEditedAt`). `test/capture.test.ts` (the confirmation payload has `reply_markup`, and the late-attempt scenario says `yesterday`). `test/ledger.test.ts` (the new field). `test/entry.test.ts` (`HELP_LINES`, the job lines of `/ping`, and the tick that now has jobs). `test/helpers/db.ts` (`day_marks` and `job_sends` join the tables to clean).

**Task conventions.** These apply to every task in tasks.md:

- Tests are written first. A task that says "write the failing tests" also creates the files under test as stubs that export the names this design gives and whose function bodies call `notImplemented()` from `src/gateway/not-implemented.ts`, so the type check passes while the tests fail.
- The type check is `npm run typecheck`. One test file is `npx vitest run <file>`, or `node --test <file>` for a file under `scripts/`.
- Groups 3 to 7 of tasks.md depend only on groups 1 and 2 and touch separate directories, so they can be built in parallel. Tasks inside a group run in order unless a task says otherwise.

### Decision 19: Statement budget

| Path | Statements |
|---|---|
| A press (`s`, the longest) | allowed chat 1 · claim 1 · member 1 · `getEntry` 1 · `setEntryCategory` 1 to 2 · `teachKeyword` 1 · entries 1 · payer 1 · finish 1 = 10 |
| `/undo` | 3 gateway · `findRemovalAt` 1 · latest 1 · soft delete 1 to 2 · entries 1 · payer 1 · finish 1 = 11 |
| A report command | 3 gateway · totals 1 · finish 1 = 5 |
| A tick where all four jobs are due | pre-read 1 · chat id 1 · 4 × (claim 1 + finish 1) · digest 2 + 2 · recap 3 + 2 · nudge 2 + 2 · backup 3 + 4 = 30 |

All are under the 50-statement limit (docs/epic.md:155).

## Invariant sweep

Values that are derived once and read in several places. Each has one home, and every reader is listed.

| Value | One home | Readers, all on the canonical form |
|---|---|---|
| Confirmation text and buttons | `renderConfirmation` | capture's first send (src/capture/index.ts:64, replaced), the `u`, `r`, `s`, `b` presses and `c` on a removed entry, `/undo`, the edit handler. `confirmationText` is deleted, so no reader is left on the old form |
| Date word's base | inside `renderConfirmation` | the same readers. Capture's `sentOn` (src/capture/index.ts:63) is deleted |
| Press data | written by `renderConfirmation` and `categoryGrid`, read by `parsePress` | the five corrections callbacks. The nudge's `n:<date>` has its own writer and reader in `src/nudge/index.ts` |
| Learned keyword text | `teachKeyword` normalizes at the write | the matcher normalizes again on read (src/categories/match.ts:64), which is a no-op on stored keywords. `listKeywordRows` and the backup carry the stored form. The notice shows the stored form |
| "Counts as spending" | `countsAsSpending` and `NOT_COUNTED_IDS` in `src/categories/lookup.ts` | `buildReport`, the monthly recap's `largestEntries` call |
| Today, week and month bounds | `localDate` (src/parser/dates.ts:7) and `src/reports/periods.ts` | the three report commands, `/export`. Jobs read `job.scheduledDate` and the same period helpers, never `job.now` |
| Money, category and date text | `src/capture/format.ts` | the renderer, reports, digests, the `/undo` reply, the nudge texts |
| CSV cell encoding | `csvCell` | every cell of the export, backup and keywords files. `decodeCell` in the restore script is its inverse, pinned by shared literal rows |
| `/undo`'s removal time | the command's send time | `softDeleteEntry` (write) and `findRemovalAt` (read), both in the `/undo` handler |

## Risks / Trade-offs

- **A confirmation's date word changes for messages first handled after midnight** → The spec states it, the scenario "A late attempt keeps the send date" covers it, and the entry's spent-on date is unchanged.
- **The module-scope `env` import is new to this codebase** → The type declares it and the test helpers already import it (test/helpers/gateway-state.ts:1). `readNudgeSettings` is pure and tested without it. If the runtime rejected it, the fallback is to drop `NUDGE_HOUR` and keep the hour in `src/config/schedule.ts`.
- **A streamed multipart upload from a Worker has not been exercised in this project** → The `/export` and backup tests send a real file through the stub and read it back. The manual check after deploy is `/export`. The fallback is a `FormData` body with a `Blob`, sent with `fetch`.
- **Stale learned keywords** → The latest correction wins. A wrong keyword is fixed by correcting one more entry.
- **The nudge and the digests go to the group at fixed hours** → `NUDGE_ENABLED` turns the nudge off. The digest hours are constants in `src/config/schedule.ts`.
- **A killed Worker can send a job message twice** → Accepted, see Decision 12.
- **Two `/undo` commands in one second remove one entry** → Accepted, see Decision 8. The second reply names the same entry, so the member sees what happened.
- **`/export all` grows with the ledger** → Accepted by the epic. The paid plan lifts the CPU limit.
- **Rows stored before migration `0005` have no edit mark** → Correct: they were not edited after being logged, as far as the bot knows.
- **A change of `HOUSEHOLD_TZ` shifts the date word of old confirmations when they are next edited** → Not handled. The setting is not expected to change.

## Migration Plan

1. Run `npm run db:migrate:remote`. Migration `0005` only adds a nullable column, two indexes and two tables, so the deployed Worker keeps working against the migrated database.
2. Add `NUDGE_ENABLED` and `NUDGE_HOUR` to `wrangler.jsonc` if the defaults are not wanted. Optionally set `BACKUP_CHAT_ID`.
3. Run `npm run deploy`.
4. In the group: send `lunch 250` and check the buttons, tap `Undo` and `Restore`, send `/week`, `/export` and `/ping`. `/ping` lists four jobs as `not run yet`.
5. After the first night, follow `docs/backup-restore.md` once with that night's files and a scratch database. This is the restore drill of the epic's exit criteria.

**Rollback.** Deploy the previous version. The new tables, the column and the indexes can stay: the old code does not read them. Confirmations sent by the new version keep their buttons, and the old version answers a press with `This button no longer works.`

## Open Questions

None that block the specs or the tasks. Whether the backup should go to a private chat is a setting the household can change after the first week.
