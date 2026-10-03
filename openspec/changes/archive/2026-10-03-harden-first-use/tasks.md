## 1. Parser gate (design Decisions 1 to 5; `specs/expense-parsing/spec.md`, `specs/expense-capture/spec.md`)

- [x] 1.1 In `src/parser/words.ts`, keep a `+` that starts a word and is joined to a digit as part of the word. Add rows to `test/unit/parser-words.test.ts`. Verify: `npx vitest run test/unit/parser-words.test.ts` passes.
- [x] 1.2 In `src/parser/amounts.ts`, read a plain number of two or more digits that starts with `0` as not an amount. Move the `007` row of `test/unit/parser-amounts.test.ts` to the rejected rows and add `0917` and `+1`. Verify: `npx vitest run test/unit/parser-amounts.test.ts` passes.
- [x] 1.3 In `src/parser/index.ts`, leave out a plain number that follows a word of `NOT_AMOUNT_BEFORE` (with at most one linking word between) and a plain number in a digit group. A marked number is still read. Verify: the scenarios added to "Numbers that are not amounts" pass in `test/unit/parser.test.ts`.
- [x] 1.4 In `src/parser/phrases.ts`, make `may` and `jan` a month name only after a day number, and read a year after a month and day, or after one comma there, as part of the date. Add `exactDate` to `src/parser/dates.ts`. Add rows to `test/unit/parser-phrases.test.ts`. Verify: `npx vitest run test/unit/parser-phrases.test.ts` passes.
- [x] 1.5 Add one test per new scenario to `test/unit/parser.test.ts`, under the describe of its requirement, and a `Date with a year` describe. Verify: `npx vitest run test/unit/parser.test.ts` passes with every earlier scenario unchanged.
- [x] 1.6 In `src/capture/index.ts`, ignore a message with `forward_origin` or `via_bot`. In `test/capture.test.ts`, add the three scenarios of "Which messages are captured" and five rows to "Ordinary chat gets no reply". Verify: `npx vitest run test/capture.test.ts` passes.

## 2. Button presses (design Decision 6; `specs/entry-corrections/spec.md`)

- [x] 2.1 In `src/corrections/presses.ts`, refuse a press with the stale-button notice unless the pressed message is the entry's confirmation, checked after the entry is read and before anything changes. Give `callbackUpdate` and the corrections harness an optional `replyToMessageId`. Add the four scenarios to `test/corrections-presses.test.ts`. Verify: `npx vitest run test/corrections-presses.test.ts test/corrections-learning.test.ts test/corrections-undo.test.ts test/corrections-edited.test.ts` passes.

## 3. Failure alert (design Decision 7; `specs/job-scheduler/spec.md`, `specs/data-export/spec.md`)

- [x] 3.1 Add the optional `alertOnFailure` to `JobRegistration` in `src/gateway/registry.ts`. In `src/scheduler/index.ts`, add the `alert` action for a job that asks, sent through `sendOnce` with the part `failure_alert`; export `slotLabel` and `state` from `src/scheduler/status.ts` for its text. Verify: `npx vitest run test/scheduler.test.ts test/unit/scheduler-status.test.ts` passes, with the scenario "a job that did not ask" asserted in the existing after-the-window test.
- [x] 3.2 Register `nightly_backup` with `alertOnFailure: true` in `src/export/index.ts`. Add the describe "tell the group when a backup did not finish" to `test/backup.test.ts`, one test per scenario. Verify: `npx vitest run test/backup.test.ts` passes.

## 4. `/export all` limit (design Decision 8; `specs/data-export/spec.md`, `specs/expense-ledger/spec.md`)

- [x] 4.1 Add `countActiveEntries` to `src/ledger/index.ts`, with the four scenarios in `test/ledger-additions.test.ts`. Verify: `npx vitest run test/ledger-additions.test.ts` passes.
- [x] 4.2 In `src/export/command.ts`, count before building the file for `all` and reply with the text above `EXPORT_ALL_MAX_ENTRIES`. Add the three scenarios to `test/export.test.ts`, storing the rows with one statement. Verify: `npx vitest run test/export.test.ts` passes.

## 5. Setup, tests and runbook (design Decisions 9 to 11; `specs/bot-gateway/spec.md`, `specs/data-export/spec.md`)

- [x] 5.1 Pin `NUDGE_ENABLED` and `NUDGE_HOUR` in `vitest.config.mts`. Make `envWith` in `test/backup.test.ts` drop `BACKUP_CHAT_ID` unless given. Add `scripts/lib/jsonc.mjs` with its test, and make `scripts/wrangler-config.test.mjs` assert only the cron trigger and the `DB` binding. Verify: `npm test` passes with `NUDGE_ENABLED` `false`, `NUDGE_HOUR` `20`, a `BACKUP_CHAT_ID`, a trailing comma and an end-of-line comment in `wrangler.jsonc`, and the file is restored afterwards.
- [x] 5.2 Add `--escaped` to the `bot-info` step in `scripts/setup.mjs`, with one test in `scripts/setup.test.mjs`. Verify: `node --test scripts/setup.test.mjs` passes.
- [x] 5.3 Correct `docs/setup.md`: `--binding DB`, the `BOT_INFO` example, the secrets uploaded by the first deploy, and what each invalid setting does. Verify: `node --test scripts/guide.test.mjs` passes.
- [x] 5.4 Rewrite "Apply it to the real database" in `docs/backup-restore.md` with the lost-database order, and ignore `/backups/`, `/restore.sql` and `/before-restore*.sql` in `.gitignore`. Verify: files with those names at the top of the repository do not show in `git status`.
- [x] 5.5 Update `README.md` and add "Fixed since the review" to `docs/telegram-readiness.md`, so no document describes a defect that is gone.

## 6. Whole-project checks

- [x] 6.1 `npm test`, `npm run typecheck` and `npx wrangler deploy --dry-run` pass.

## 7. Command replies and stale presses (design Decisions 12 and 13; `specs/bot-gateway/spec.md`)

- [x] 7.1 Add `allow_sending_without_reply: true` to the replies in `src/core/index.ts`, `src/reports/index.ts`, `src/export/command.ts` and `src/corrections/undo.ts`, and assert it in `test/commands.test.ts`, `test/reports.test.ts`, `test/export.test.ts` and `test/corrections-undo.test.ts`. Verify: `npx vitest run test/commands.test.ts test/reports.test.ts test/export.test.ts test/corrections-undo.test.ts` passes.
- [x] 7.2 Answer a press with no handler through `answerPress` in `src/gateway/bot.ts`, with the scenario "Unknown prefix, pressed too late to answer" in `test/routing.test.ts`. Verify: `npx vitest run test/routing.test.ts` passes.

## 8. Telegram client (design Decision 14; `specs/bot-gateway/spec.md`)

- [x] 8.1 Add `src/telegram/client.ts` with `telegramClientOptions` and `waitOutShortRateLimits`, and its unit test `test/unit/telegram-client.test.ts`. Verify: `npx vitest run test/unit/telegram-client.test.ts` passes.
- [x] 8.2 Use both in `buildBot` and in the scheduler's `Api`. Add `parameters` to `InjectedError` in `test/helpers/telegram.ts`, and one test of each client waiting out a 429 in `test/routing.test.ts` and `test/scheduler.test.ts`. Verify: `npx vitest run test/routing.test.ts test/scheduler.test.ts test/inplace.test.ts` passes, with the 429 tests of `test/inplace.test.ts` unchanged.

## 9. Which number wins (design Decision 15; `specs/expense-parsing/spec.md`)

- [x] 9.1 Change `chooseAmount` in `src/parser/index.ts`, add the new scenarios of "Several numbers in one item" to `test/unit/parser.test.ts`, and change the message of "More days ago than the limit is not a date". Verify: `npx vitest run test/unit/ test/capture.test.ts` passes.

## 10. Catch-up windows (design Decision 16; `specs/job-scheduler/spec.md`, `specs/scheduled-digests/spec.md`, `specs/logging-nudge/spec.md`)

- [x] 10.1 Replace `GRACE_MINUTES` with `DEFAULT_CATCH_UP_HOURS` and `catchUpMinutes` in `src/scheduler/schedule.ts`, add `catchUpHours` to `JobRegistration`, validate it in `validateJobs`, and use it in `decide`. Let `probeModule` pass `catchUpHours` and `alertOnFailure`. Verify: `npx vitest run test/scheduler.test.ts` passes.
- [x] 10.2 Register `weekly_digest` with 24 hours, `monthly_recap` with 48 and `evening_nudge` with 2, from `src/config/schedule.ts`. Add the window scenarios to `test/digests.test.ts` and `test/nudge.test.ts`. Verify: `npx vitest run test/digests.test.ts test/nudge.test.ts` passes.

## 11. Alert after a skip (design Decision 17; `specs/job-scheduler/spec.md`, `specs/data-export/spec.md`)

- [x] 11.1 Return `hasEarlierRun` from `findRuns`, alert on a skipped run that has one, with its own text. Add the two scenarios to `test/backup.test.ts` and update `test/job-runs.test.ts`. Verify: `npx vitest run test/backup.test.ts test/job-runs.test.ts` passes.

## 12. Failure reasons (design Decision 19; `specs/job-scheduler/spec.md`, `specs/bot-gateway/spec.md`)

- [x] 12.1 Add `lastError` to `RunRecord` and `latestRuns`, and the reason to `failed` lines in `src/scheduler/status.ts`. Verify: `npx vitest run test/unit/scheduler-status.test.ts test/scheduler-ping.test.ts test/job-runs.test.ts` passes.
- [x] 12.2 Add `src/gateway/failure.ts`, and log its code as `reason` on `attempt_failed` and `job_failed`. Verify: `npx vitest run test/update-log.test.ts test/scheduler.test.ts` passes, with the error text still absent from every log entry.

## 13. Monthly snapshot (design Decision 18; `specs/data-export/spec.md`)

- [x] 13.1 Add `maxEntryId` and `listEntriesByIdRange` to `src/ledger/index.ts`, and the snapshot part to `runNightlyBackup` in `src/export/backup.ts`. Add the describe "send the whole ledger each month, a part a night" to `test/backup.test.ts`. Verify: `npx vitest run test/backup.test.ts` passes.

## 14. Docs (design Decision 20)

- [x] 14.1 In `docs/backup-restore.md`, add D1 Time Travel, the missing-entries check, and the snapshot files to collect. In `docs/setup.md`, say to develop locally with a second bot and give each job's catch-up window. Update `README.md` and the "Fixed since the review" section of `docs/telegram-readiness.md`. Verify: `node --test scripts/guide.test.mjs` passes.

## 15. Whole-project checks, second round

- [x] 15.1 `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run` and `openspec validate harden-first-use --strict` pass.
