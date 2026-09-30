## 1. Failing tests first

- [x] 1.1 Create the types and the import-only stubs (design Decision 14, D46). Create these files, exporting exactly the names and types in design Decision 15:
  - `src/ledger/types.ts` with the complete types;
  - `src/ledger/index.ts`;
  - `src/categories/categories.ts`, `keywords.ts`, `lookup.ts`, `normalize.ts`, `match.ts`, `store.ts` and `index.ts`;
  - `src/capture/format.ts` and `src/capture/index.ts`.

  Every function calls `notImplemented()` from `src/gateway/not-implemented.ts`. `createMatcher` also calls it, and does not return a function. `CATEGORIES` is `[]`, and `SEED_KEYWORDS` is `{}`. The constants `MAX_ENTRIES_PER_MESSAGE`, `MIN_AMOUNT_CENTAVOS`, `MAX_AMOUNT_CENTAVOS`, `CURRENCY` and `FALLBACK_CATEGORY_ID` carry their real values. `src/capture/index.ts` exports `capture = { name: "capture", messages: [handleCapture] }`. Do not change `src/modules.ts` or any other existing file. Verify: `npm run typecheck` passes, `npm test` passes as it did before, and `git status --short -- src migrations test` lists only the new directories `src/ledger/`, `src/categories/` and `src/capture/`. If the type check cannot pass for a reason outside this project's code, stop and report it.
- [x] 1.2 Add the schema and extend the test helpers (design Decisions 2, 10 and 14, D43, D46, D47). This task depends on 1.1, so the two never share the working tree at the same time.
  - Add `migrations/0002_expense_ledger.sql` and `migrations/0003_categorization.sql`, exactly as in design Decisions 2 and 10.
  - In `test/helpers/db.ts`:
    - add `"expenses"` and `"keyword_map"` to `TABLES`, and change the two doc comments that say "three tables";
    - add `failInsideBatch(predicate: (sql: string, position: number) => boolean)` to `FailingDb`. It swaps each accepted statement inside `db.batch` for `SELECT json('{')` and sends the batch to D1, and `heal()` clears it.
  - In `test/helpers/telegram.ts`, add `failNext(method, error?)` to `TelegramStub`. It records the next call to that method with `failed: true`, and answers it with `{ ok: false, error_code, description }` and that HTTP status, by default 500 and `"Internal Server Error: injected"`.
  - In `test/helpers/updates.ts`, add `stickerUpdate(options?)` and `voiceUpdate(options?)` beside `photoUpdate`.
  - In `test/harness.test.ts`, assert that `expenses` and `keyword_map` exist, and insert one row into each before the reset check.
  - In `test/helpers.test.ts`, add cases:
    - `failNext` fails exactly one call with a `GrammyError`, marks it `failed`, and then answers normally;
    - the sticker and voice builders carry no `text`;
    - a batch of `INSERT` `settings` key `x` followed by a duplicate `INSERT` of key `x` rejects and leaves no row `x`;
    - `failInsideBatch` at position 1 rejects a two-statement batch and leaves no trace of position 0;
    - `heal()` clears `failInsideBatch`.

  Verify: `npx vitest run test/helpers.test.ts test/harness.test.ts` passes, `npm test` passes, and `npm run typecheck` passes. If the duplicate-key batch leaves the row `x`, stop and report it, because design Decision 4 depends on D1 rolling back a batch.
- [x] 1.3 Write the failing ledger tests (depends on 1.1 and 1.2): `test/ledger.test.ts`.
  - Write one test for each scenario of `specs/expense-ledger/spec.md`, named after it, in `describe` blocks named after the requirements.
  - Follow test/stores.test.ts:16-88: `useCleanTables(env.DB)`, a fixed `NOW` with `later(ms)`, and rows read back with `SELECT *` into a snake_case row type and compared with `toEqual`.
  - Build writes with a local `write(overrides)` helper.
  - Run the invalid-write table against `failingDb(env.DB)` after `failAll()`, and assert `rejects.toThrow(RangeError)` with the field's name in the message. The three malformed-date scenarios also assert `rejects.toThrow(RangeError)` (design Decision 14).
  - "One item fails to store" uses `failInsideBatch((sql, position) => position === 1)`, then `heal()` and the same write again.
  - "The table refuses invalid entries written directly" is an `it.each` over raw-SQL inserts. Each row first inserts a valid baseline row, which must succeed. It then asserts the refusal message: `/CHECK constraint failed/`. The duplicate-key row leaves out `id` and asserts `/UNIQUE constraint failed: expenses\.chat_id, expenses\.source_message_id, expenses\.item_index/`, which only the index `expenses_source_item` can produce.

  The stub guard of design Decision 14 applies. Verify: `npx vitest run test/ledger.test.ts` runs every test, only "The table refuses invalid entries written directly" passes, every other test fails on a `not implemented` error or its assertion.
- [x] 1.4 Write the failing categories tests (depends on 1.1 and 1.2).
  - `test/unit/categories.test.ts`: one test for each scenario of the requirements Category list, Category id validation, Seed keywords, Text normalization and Keyword matching in `specs/categorization/spec.md`, named after it. Use `it.each` tables with a label column for the normalization and matching cases. Each invariant test first asserts that its list is not empty. Matching tests call `createMatcher(learned)(description)`.
  - `test/keywords.test.ts`: the three scenarios of the requirement Learned keywords table, against `env.DB`, with `useCleanTables(env.DB)` and rows inserted through raw SQL. "A keyword appears once" asserts that the first insert succeeds and the second fails with `/UNIQUE constraint failed: keyword_map\.keyword/`. Add one more test, "The learned keywords migration inserts no rows". It finds exactly one migration named `0003_categorization.sql` in `env.TEST_MIGRATIONS`, checks that one of its queries contains `CREATE TABLE keyword_map`, and then asserts that no query starts with `INSERT`, ignoring case and leading white space.

  The stub guard of design Decision 14 applies. Verify: `npx vitest run test/unit/categories.test.ts test/keywords.test.ts` runs every test, only "A keyword appears once" and "The learned keywords migration inserts no rows" pass, every other test fails on a `not implemented` error, an empty list or its assertion.
- [x] 1.5 Write the failing formatter tests (depends on 1.1 and 1.2, so that no failing test file exists while 1.2 runs the whole suite): `test/unit/capture-format.test.ts`, with `it.each` tables for:
  - `formatPesos`: 5, 25000, 150050, 252000, 100000000 and 999999999 centavos;
  - `dateLabel`: today, yesterday, the same year, the previous year, and across a month end;
  - `categoryLabel`: a known id and an unknown id;
  - `confirmationText`: one entry, two entries, a flagged entry in each form, an empty description, an unknown category id, and descriptions of 60 and 61 characters;
  - `rejectionText`: every `RejectionReason`, with the texts of design Decision 13.

  Build entries with a local `entry(overrides)` helper. Expected strings are written out in full. The stub guard of design Decision 14 applies. Verify: `npx vitest run test/unit/capture-format.test.ts` runs every test, and each fails on a `not implemented` error.
- [x] 1.6 Write the failing capture and registration tests (depends on 1.1 and 1.2).
  - `test/capture.test.ts`: one test for each scenario of `specs/expense-capture/spec.md` except the three of the requirement Capture is registered, named after it, in `describe` blocks named after the requirements.
    - Use `useCleanTables(env.DB)` and the full gateway with `createGateway({ modules: [core, capture], now: () => now })`, set up as in test/commands.test.ts:24-40 and design Decision 14 "Capture test setup".
    - Assert status 200 for every handled update, except the first attempt of a retry scenario, which asserts 500.
    - Assert each reply's `text`, `reply_parameters.message_id`, `reply_parameters.allow_sending_without_reply` and `link_preview_options`, and that `parse_mode` is absent.
    - Count successful sends by leaving out calls marked `failed`. Read the rows with SQL.
  - `test/entry.test.ts`: add the three scenarios of the requirement Capture is registered, as design Decision 14 "Registration tests" describes. Replace the existing `/help` assertions with the exact `toEqual` of the reply's lines.

  The stub guard of design Decision 14 applies. Verify: `npx vitest run test/capture.test.ts test/entry.test.ts` runs every test, only "Capture adds no command" and the existing "Deployed bot uses the registration list" pass, and every other new test fails.
- [x] 1.7 Check the whole failing suite once (depends on 1.3, 1.4, 1.5 and 1.6). Tasks 1.3 to 1.6 share the working tree in parallel, so none of them runs the project-wide type check. This task runs it alone. Verify:
  - `npm run typecheck` passes;
  - `npx vitest run test/ledger.test.ts test/unit/categories.test.ts test/keywords.test.ts test/unit/capture-format.test.ts test/capture.test.ts test/entry.test.ts` runs every test;
  - the tests that pass are exactly the four feature tests listed in design Decision 14, plus the existing cases of `test/entry.test.ts`.

  Fix only type errors, test-harness mistakes, a test that does not run, or a test that passes against the stubs, by tightening that test. Never change a file under `src/`, and never make a feature test pass.

## 2. Ledger, categories and capture (make §1 green)

Tasks 2.1 to 2.3 may share the working tree in parallel, so none of them runs the project-wide type check. Task 2.4 runs it after all three.

- [x] 2.1 Implement `src/ledger/index.ts`:
  - validation as in design Decision 5, before any statement is sent;
  - `addMessageEntries` as in Decision 4, with plain `INSERT` statements;
  - the guarded updates of Decision 3;
  - the queries of Decision 6;
  - one `toEntry` row mapper.

  No function catches a D1 error. Verify: `npx vitest run test/ledger.test.ts` passes, and `grep -rnE "from ['\"](\.\./)+(parser|categories|capture)" src/ledger` finds nothing.
- [x] 2.2 Implement `src/categories/`:
  - the 14 categories of the `categorization` spec in `categories.ts`;
  - the keywords of design Decision 9 in `keywords.ts`;
  - `lookup.ts` as in Decision 7;
  - `normalize.ts` as in Decision 8;
  - `createMatcher` in `match.ts` as in Decision 10, with the seed index built once at module load;
  - `listKeywords` in `store.ts`;
  - the re-exports in `index.ts`.

  Verify: `npx vitest run test/unit/categories.test.ts test/keywords.test.ts` passes, and `grep -rnE "from ['\"](\.\./)+(ledger|parser|capture)" src/categories` finds nothing.
- [x] 2.3 Implement `src/capture/format.ts` as in design Decisions 12 and 13 (depends on 2.2 for `getCategory`):
  - integer arithmetic only in `formatPesos`;
  - a description cut to 59 code points plus `…` when it is longer than 60;
  - a `switch` in `rejectionText` with an exhaustive `never` check.

  Verify: `npx vitest run test/unit/capture-format.test.ts` passes.
- [x] 2.4 Implement `handleCapture` in `src/capture/index.ts` as the nine steps of design Decision 11 (depends on 2.1, 2.2 and 2.3).
  - Build one matcher per message with `createMatcher`.
  - Use the private `reply` helper with `reply_parameters: { message_id, allow_sending_without_reply: true }` and `link_preview_options: { is_disabled: true }`.
  - Log `capture_confirmation_unsaved` with exactly `update_id`, `message_id` and `confirmation_message_id`.
  - Then add the import of `capture` and the `capture` entry after `core` in `src/modules.ts`.
  - Change no file under `src/gateway/`, `src/core/` or `src/parser/`.

  Verify:
  - `npx vitest run test/capture.test.ts test/entry.test.ts` passes;
  - `npm test` passes with no test skipped;
  - `npm run typecheck` passes, and any type error it reports in `src/ledger/`, `src/categories/` or `src/capture/` is fixed here;
  - `git diff --stat -- src/gateway src/core src/parser` shows nothing;
  - `git diff -- src/modules.ts` shows only the import and the list entry.
