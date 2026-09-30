## Context

See proposal.md for the motivation. This change adds EB-03, EB-04 and EB-05 in one change (D1), named `add-expense-capture` (D2). It builds on two archived changes:

- **The gateway** (`bot-gateway`) receives each update, processes it at most once after a success, and runs every message handler again after a failed attempt, up to 3 attempts (openspec/specs/bot-gateway/spec.md:203, 215-217; src/gateway/update-log.ts:4). A handler gets `ctx.gateway = { env, db, now, timezone, chatId, member, registry }` (src/gateway/registry.ts:46-56). It never learns which attempt it is on (src/gateway/index.ts:147-154).
- **The parser** (`expense-parsing`) is a pure function, `parseExpenseMessage(text, now, timezone)`. It returns items, "not an expense", or a rejection, and it enforces the limit of 10 items (src/parser/index.ts:9, 48).

Constraints that shape the design:

- **D1 has no interactive transactions.** One statement is atomic, and one `batch()` runs as one transaction (openspec/changes/archive/2026-09-29-add-bot-gateway/design.md:20).
- **Limits per invocation.** An invocation may run 50 D1 statements, and the gateway uses at most 6 of them. CPU time is limited to 10 ms (docs/epic.md:153-155).
- **Four shared files.** Later issues add lines to `src/modules.ts`, `src/index.ts`, `wrangler.jsonc` and `migrations/`, and never rewrite existing gateway code (archived gateway decisions D33).
- **Schema conventions from 0001.** Tables are `STRICT`, with ISO-8601 UTC text timestamps, `INTEGER` Telegram ids, `CHECK`-constrained text enums, and no triggers (migrations/0001_bot_gateway.sql:1-30).

The explore brief with the evidence is `.claude/handoff/explore-add-expense-capture-20260930-214212.md`. Every decision below cites the row of `decisions.md` that records it.

## Goals / Non-Goals

**Goals:**
- The ledger is safe to call twice for the same message, and stores all of a message's items or none of them. A test proves the rollback against the real D1 runtime.
- Capture is safe to repeat from the database's state alone, and needs no change to the gateway.
- The matcher and the formatter are pure functions, and a table of cases tests each of them.
- The ledger and categories modules are libraries that later issues can call without Telegram: from handlers through `ctx.gateway.db`, and from jobs through `job.db`.

**Non-Goals:**
- Any change to a gateway or parser file. Capture reads the parser's `localDate` and `shiftDate` as they are (D48).
- Writing to `keyword_map`. EB-07 and EB-13 do that.
- Honoring Telegram's `retry_after` on a 429. The gateway's fixed retry applies.

## Decisions

### Decision 1: Layout and boundaries (D3, D21)

```
src/ledger/      types.ts  index.ts                 library: store functions over D1
src/categories/  categories.ts  keywords.ts         configuration files (data only)
                 lookup.ts  normalize.ts  match.ts  pure functions
                 store.ts  index.ts                 keyword_map reader, public API
src/capture/     format.ts  index.ts                pure formatting; the feature module
migrations/      0002_expense_ledger.sql  0003_categorization.sql
```

- **Allowed imports.** `src/ledger/` imports nothing from `src/parser/`, `src/categories/` or `src/capture/`. `src/categories/` imports nothing from `src/ledger/`, `src/parser/` or `src/capture/`. Only `src/capture/` imports from all three and from `src/gateway/registry.ts`.
- **Structural typing instead of imports.** The ledger's item input reuses the parser's field names, `amountCentavos` and `description`. Capture maps each parsed item field by field (Decision 11, step 6) and needs no adapter type. The date field is `spentOn`.
- **Registration.** Only capture registers anything. `src/modules.ts` gains an import and one entry and becomes `[core, capture]`. Capture's handler must be the last message handler, because the retry analysis in Decision 11 relies on it. A module added later is inserted before capture, not appended. A test in `test/entry.test.ts` pins the order (D57).
- **No find-by-id.** This change does not add a find-by-id operation, because nothing in it needs one (D21). EB-06 adds it.

### Decision 2: The `expenses` table (D4, D11, D12, D22, D23, D24)

`migrations/0002_expense_ledger.sql`:

```sql
CREATE TABLE expenses (
  id                      INTEGER PRIMARY KEY,
  chat_id                 INTEGER NOT NULL,
  source_message_id       INTEGER NOT NULL,
  item_index              INTEGER NOT NULL CHECK (item_index BETWEEN 0 AND 9),
  confirmation_message_id INTEGER,
  payer_user_id           INTEGER NOT NULL,
  amount_centavos         INTEGER NOT NULL CHECK (amount_centavos BETWEEN 1 AND 999999999),
  currency                TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  description             TEXT    NOT NULL,
  category_id             TEXT    NOT NULL CHECK (category_id <> ''),
  category_source         TEXT    NOT NULL CHECK (category_source IN ('keyword', 'learned', 'llm', 'manual', 'default')),
  spent_on                TEXT    NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  raw_text                TEXT    NOT NULL,
  parser                  TEXT    NOT NULL CHECK (parser IN ('rules', 'llm')),
  check_amount            INTEGER NOT NULL CHECK (check_amount IN (0, 1)),
  created_at              TEXT    NOT NULL,
  created_by              INTEGER NOT NULL,
  updated_at              TEXT    NOT NULL,
  updated_by              INTEGER NOT NULL,
  deleted_at              TEXT,
  deleted_by              INTEGER,
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;

CREATE UNIQUE INDEX expenses_source_item ON expenses (chat_id, source_message_id, item_index);
CREATE INDEX expenses_spent_on ON expenses (spent_on) WHERE deleted_at IS NULL;
CREATE INDEX expenses_payer_created ON expenses (payer_user_id, created_at) WHERE deleted_at IS NULL;
```

- **`id` (D11)** is a rowid alias, with no `AUTOINCREMENT`. Rows are never deleted, so ids grow in insertion order. A short id fits Telegram's 64 bytes of button data (docs/epic.md:445).
- **The unique index `expenses_source_item`** is the idempotency key. It includes `chat_id` because a message id is unique only within its chat, and a supergroup migration starts a new chat.
- **Actor columns (D12).** `created_*`, `updated_*` and `deleted_*` hold ISO-8601 UTC text from the `now` passed in, and Telegram user ids.
- **Soft delete (D44).** A soft delete also sets `updated_*`, so `updated_*` always records the last change by a member.
- **`check_amount` (D22)** keeps the parser's `ambiguous_amount` flag. A confirmation built on a retry (Decision 11), or edited in place by EB-06, can then still show `⚠️ check amount`.
- **`currency` (D23, D55).** The ledger always writes `PHP`. The column accepts any 3 capital letters, through a `GLOB` that refuses digits and punctuation, so multi-currency later needs no table rebuild.
- **No foreign keys (D24).** This follows the gateway. `members` rows are kept forever, so a payer id always resolves to a name.
- **Partial indexes.** They serve the two common reads: active entries by date for totals, lists and counts, and a member's latest active entry. A `STRICT` `INTEGER` column also refuses a value like `250.5`.

### Decision 3: Store style (D5)

The store functions follow `src/gateway/update-log.ts`:

- Each is an exported `async function` with `db: D1Database` first. A function that writes takes `now: Date`, inside an input object when the input has several fields.
- SQL is inline. Values are bound, never interpolated.
- Rows are typed with snake_case, and one `toEntry(row)` maps them to the camelCase `Entry`, with `check_amount` becoming a boolean.
- No function catches a D1 error. Errors reach the caller, which in capture means the gateway fails the attempt.

A change of state follows the claim pattern of update-log.ts:47-71. It runs one guarded `UPDATE ... RETURNING *`. When no row comes back, a `SELECT` of the id tells `unchanged` apart from `not_found` (D14).

| Operation | Guard in the `UPDATE` | Columns set |
|---|---|---|
| `softDeleteEntry` | `id = ? AND deleted_at IS NULL` | `deleted_at`, `deleted_by`, `updated_at`, `updated_by` |
| `restoreEntry` | `id = ? AND deleted_at IS NOT NULL` | `deleted_at = NULL`, `deleted_by = NULL`, `updated_at`, `updated_by` (D15) |
| `setEntryCategory` | `id = ? AND deleted_at IS NULL AND (category_id <> ? OR category_source <> ?)` | `category_id`, `category_source`, `updated_at`, `updated_by` |
| `attachConfirmation` | `chat_id = ? AND source_message_id = ? AND confirmation_message_id IS NULL` | `confirmation_message_id` only (D13). Returns the number of rows filled |

### Decision 4: Writing one message, once, all or nothing (D6, D7, D10)

`addMessageEntries(db, input)` runs in three steps:

1. **Validate** the input as in Decision 5. A failure throws `RangeError`, and nothing is sent to D1.
2. **Check.** `SELECT * FROM expenses WHERE chat_id = ? AND source_message_id = ? ORDER BY item_index`. When the message already has rows, return `{ created: false, entries }` with those rows. They are returned whatever their state, and the new input is ignored (D7).
3. **Write.** Send one `db.batch` of one plain `INSERT` per item, with `item_index` set to the item's position, followed by the same `SELECT` as step 2. Return `{ created: true, entries }` with the rows the final `SELECT` read.

- **Atomicity.** The batch is one transaction, so a failure in any of its statements leaves no row of the message. The test in Decision 14 proves this against the real runtime.
- **A racing write fails whole.** Another write for the same message can commit between the check and the batch. The gateway's lease rules this out for capture, but the ledger is a library. In that case one `INSERT` hits the unique index `expenses_source_item`, and the whole batch rolls back and throws. A caller that retries then finds the stored rows at step 2. `INSERT ... ON CONFLICT DO NOTHING` was rejected, because it would silently add the racing write's extra items to the stored set and report `created: true` (D6).
- **Statements.** At most 1 + 10 + 1 = 12 of the 50 allowed.

A single multi-row `INSERT` was rejected because it needs 170 bound parameters, and D1 allows 100. `INSERT ... SELECT FROM json_each(?)` was rejected because it gains nothing a batch does not give, and its SQL is harder to review.

The ledger defines its own `MAX_ENTRIES_PER_MESSAGE = 10` (D10). It does not import the parser's `MAX_ITEMS`, because a future LLM path (EB-13) writes without the parser.

### Decision 5: Validation (D8, D9)

`addMessageEntries` throws `RangeError` with a message that names the field in each of these cases:

- `items` is empty or has more than 10 entries.
- `amountCentavos` is not a safe integer, or is outside 1 to 999,999,999 (D9).
- `spentOn` does not match `/^\d{4}-\d{2}-\d{2}$/`.
- `categoryId` is empty.
- `categorySource` or `parser` is not one of the allowed values.

The period functions (`totalsByCategory`, `listEntries`, `countActiveEntriesOn`) throw `RangeError` for a date that does not match the same pattern. The `CHECK` constraints of Decision 2 repeat the amount, enum, date-shape and removal-pair rules, so a row written without the ledger is refused too.

Real calendar dates are not checked. The parser already guarantees them, and importing its checks would couple the ledger to the parser.

### Decision 6: Queries (D16, D17, D18, D19, D20)

The queries by period, the latest entry and the count for a date cover the whole table and never filter by `chat_id` (D16). The household uses one group. After a supergroup migration the chat id changes, and entries stored before it must still count.

| Function | SQL shape | Order |
|---|---|---|
| `findEntriesBySourceMessage(db, chatId, sourceMessageId)` | `WHERE chat_id = ? AND source_message_id = ?`, removed rows included | `item_index` |
| `findLatestActiveEntry(db, payerUserId)` (D17) | `WHERE payer_user_id = ? AND deleted_at IS NULL LIMIT 1` | `created_at DESC, id DESC` |
| `totalsByCategory(db, { from, to })` (D19) | `SELECT category_id, SUM(amount_centavos), COUNT(*) ... WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ? GROUP BY category_id` | sum `DESC`, then `category_id` |
| `listEntries(db, { from, to }, { includeDeleted })` (D20) | `WHERE spent_on BETWEEN ? AND ?`, plus `AND deleted_at IS NULL` unless `includeDeleted` | `spent_on, id` |
| `countActiveEntriesOn(db, spentOn)` (D18) | `SELECT COUNT(*) ... WHERE deleted_at IS NULL AND spent_on = ?` | none |

`YYYY-MM-DD` text sorts and compares as dates, so `BETWEEN` includes both end dates. A sum fits easily in a JavaScript number: a household total stays far below 2^53 centavos.

### Decision 7: The category list and its validation (D25, D26, D33, D45)

`src/categories/categories.ts` holds data only: `export const CATEGORIES: readonly Category[]`, with the 14 rows of the `categorization` spec in display order. A category is `{ id, name, shortName, emoji, order, countsAsSpending }`.

- **`shortName` (D26)** is what replies show, such as `🍽 Dining`. `name` is the full name the epic lists.
- **Id format (D45).** An id is made of 1 to 12 lower-case letters. That keeps button data short, and makes an id safe to embed in button codes such as `s:<id>:<category>`.

`src/categories/lookup.ts` builds a `Map` from the list once, and exports:

- `isCategoryId(id: string): boolean`
- `getCategory(id: string): Category | undefined`
- `FALLBACK_CATEGORY_ID = "other"`

Unknown ids return `false` or `undefined`. Neither function ever throws, because reports must show stored ids that are no longer in the list (docs/epic.md:509).

**TypeScript files, not JSON (D25).** The parser keeps its word lists in TypeScript `const` values (src/parser/phrases.ts:11-28). The exported types are plain `string` ids, so that the stubs of section 1 in `tasks.md` compile. The invariants are checked by a unit test rather than by the type system (D33):

- ids are unique and match `/^[a-z]{1,12}$/`;
- display orders are unique;
- `other` is in the list;
- every seed keyword is non-empty and equals its own normalized form;
- no keyword is listed twice;
- every seed category id is in the list;
- `other` has no keywords, and every other category has at least 5;
- `gcash` is not a keyword.

Each invariant test first asserts that the list is not empty, so it fails against an empty stub (Decision 14).

### Decision 8: Normalization (D27)

`src/categories/normalize.ts` exports two functions:

- `normalizeWords(text: string): string[]`: `text.normalize("NFC").toLowerCase().replace(/[\u2018\u2019]/g, "'").normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC")`, then split on `/\s+/u`, then remove `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu` from each word, then drop empty words. The final NFC recomposes scripts that NFD split without marks, such as Hangul. The curly apostrophes `‘` and `’` become `'`, because phones insert them automatically, so `McDonald’s` matches the seed `mcdonald's` (D58).
- `normalizeKeyword(text: string): string`: `normalizeWords(text).join(" ")`.

**Folding accents** makes `pina` match `piña`. Members type both forms, and the fold costs nothing on ASCII text. The trade-off is that learned keywords are stored folded, so the nightly backup (EB-12) shows `pina`.

**Characters inside a word stay.** So `7-eleven`, `s&r` and `jollibee's` are each one word. `jollibee's` does not match `jollibee`, which is recorded as a risk.

**Not the parser's tokenizer.** `splitWords` is exported, but its bare form is private, its `and` token carries no bare form, and it does not lower-case (src/parser/words.ts:1-4, 59-66). Both sides of every comparison, the keyword and the description, go through `normalizeWords`, so the matcher does not need to share the parser's word boundaries. Later writers of `keyword_map` (EB-07, EB-13) MUST store `normalizeKeyword(text)`.

### Decision 9: Seed keywords (D32)

`src/categories/keywords.ts` holds data only: `export const SEED_KEYWORDS: Readonly<Record<string, readonly string[]>>`. Every keyword is already normalized.

| Category | Keywords |
|---|---|
| `groceries` | `palengke`, `puregold`, `ulam`, `grocery`, `groceries`, `supermarket`, `savemore`, `s&r`, `landers`, `7-eleven`, `bigas`, `gulay`, `karne`, `isda`, `prutas`, `milk` |
| `dining` | `jollibee`, `lunch`, `dinner`, `breakfast`, `merienda`, `kape`, `coffee`, `milk tea`, `grab food`, `grabfood`, `foodpanda`, `mcdo`, `mcdonalds`, `mcdonald's`, `chowking`, `mang inasal`, `starbucks`, `almusal`, `hapunan`, `tanghalian` |
| `transport` | `grab`, `angkas`, `pamasahe`, `toll`, `jeep`, `jeepney`, `tricycle`, `taxi`, `gasolina`, `petron`, `shell`, `caltex`, `parking`, `mrt`, `lrt`, `bus` |
| `bills` | `meralco`, `maynilad`, `manila water`, `pldt`, `converge`, `globe`, `smart`, `load`, `internet`, `wifi`, `kuryente`, `tubig` |
| `housing` | `rent`, `upa`, `renta`, `association dues`, `condo dues`, `amortization`, `hoa`, `pag-ibig` |
| `household` | `lpg`, `gasul`, `detergent`, `sabon`, `tissue`, `laundry`, `labada`, `zonrox`, `downy`, `walis`, `kasambahay` |
| `health` | `gamot`, `medicine`, `meds`, `mercury drug`, `watsons`, `doctor`, `check up`, `checkup`, `hospital`, `clinic`, `dentist`, `vitamins` |
| `kids` | `tuition`, `matrikula`, `school`, `baon`, `diaper`, `diapers`, `school supplies`, `laruan`, `toys`, `formula` |
| `family` | `padala`, `remittance`, `sustento`, `allowance`, `tulong`, `bigay` |
| `gifts` | `regalo`, `pasalubong`, `gift`, `birthday`, `wedding`, `ninong`, `ninang`, `abuloy`, `pamasko`, `christmas` |
| `personal` | `shopee`, `lazada`, `clothes`, `damit`, `shoes`, `sapatos`, `haircut`, `gupit`, `salon`, `uniqlo` |
| `fun` | `netflix`, `spotify`, `youtube premium`, `disney`, `movie`, `sine`, `concert`, `steam`, `resort`, `outing` |
| `transfer` | `cash in`, `cash-in`, `withdraw`, `withdrawal`, `atm`, `credit card`, `cc payment`, `bank transfer`, `savings` |
| `other` | none |

- **Epic examples.** Every example in docs/epic.md:350-358 is included.
- **`gcash`.** It is left out, so `groceries 2340 gcash` files under Groceries (docs/epic.md:292).
- **`grab` and `grab food`.** They are deliberately both present, so the longest-phrase rule has work to do. `milk` and `milk tea` work the same way.
- **Ambiguous words are left out.** `gas` is either gasoline or an LPG refill, and `rice` is either groceries or a meal, so neither is a seed (D60).
- **Content to review.** The human reviews this list at the checkpoint. Changing it later is an edit to one file, and the invariant test guards the edit.

### Decision 10: Learned keywords and matching (D28, D29, D30, D31)

`migrations/0003_categorization.sql`:

```sql
CREATE TABLE keyword_map (
  keyword     TEXT    PRIMARY KEY CHECK (keyword <> ''),
  category_id TEXT    NOT NULL CHECK (category_id <> ''),
  source      TEXT    NOT NULL CHECK (source IN ('learned', 'llm')),
  taught_by   INTEGER,
  hit_count   INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
) STRICT;
```

- **The primary key on `keyword`** gives "one row per keyword", which EB-07's "the latest correction replaces the earlier one" needs (docs/epic.md:460).
- **`hit_count` (D31)** exists, but nothing increments it in this change. Incrementing it on every match would add a D1 write per item to the hot path, and EB-07 owns learning. It defaults to 0.
- **`taught_by`** is absent for `llm` rows.

`src/categories/store.ts` exports `listKeywords(db): Promise<LearnedKeyword[]>`, which is `SELECT keyword, category_id, source FROM keyword_map ORDER BY keyword`. Capture reads it once per message, and only when the parser returned items.

`src/categories/match.ts` exports `createMatcher(learned): Matcher`, where `Matcher` is `(description: string) => CategoryMatch`. Capture builds one matcher per message and calls it once per item, so the learned tier is prepared once rather than up to 10 times (D56). Both functions are pure.

1. **Build, in `createMatcher`.**
   - The learned tier is `learned`, with each row's keyword split by `normalizeWords`. Rows whose `categoryId` fails `isCategoryId` (D30) are skipped, and so are rows whose keyword gives no words (D56).
   - The seed tier is `SEED_KEYWORDS`, indexed once at module load from each keyword's first word to its keyword entries.
2. **Match, in the returned function.** Normalize the description into words `w`.
3. At every start position `i` of `w`, a keyword whose words `k` satisfy `w[i + j] === k[j]` for every `j` is a match (D28).
4. Pick the best match by, in order: tier (learned first), more words, then smaller `i` (D29). Seed keywords are unique by the invariant test. Learned keywords that normalize to the same words, such as `Açaí` and `acai`, tie. The first in the `learned` array wins. Capture passes the array in `listKeywords` order (D59).
5. Return one of:
   - `{ categoryId, source: row.source, keyword: row.keyword }` for a learned match (`learned` or `llm`, D30). The keyword is the stored one, the table's key, which EB-07 needs to update the row (D59);
   - `{ categoryId, source: "keyword", keyword }` for a seed match;
   - `{ categoryId: "other", source: "default", keyword: null }` when nothing matched.

"Longest" is counted in words, not characters. "Phrase" is a unit of words, and the epic's example `grab food` against `grab` agrees either way.

The work is about (description words) × (keywords sharing the first word). That is negligible within the 10 ms CPU limit, at around 150 seed keywords and 10 items per message.

### Decision 11: The capture flow (D34, D35, D36, D37, D41, D42, D48, D49)

`src/capture/index.ts` exports `capture: FeatureModule = { name: "capture", messages: [handleCapture] }`. `handleCapture(ctx)` runs these steps:

1. **Take only text.** `const message = ctx.message`. If `typeof message?.text !== "string"`, return (D35). Photos, stickers, voice notes and service messages carry no `text`. Edits never reach a message handler, and capture registers no `editedMessages` handler. Forwarded texts and replies to the bot are captured like any text (D42).
2. **Parse at the send time.** `sentAt = new Date(message.date * 1000)`, and `result = parseExpenseMessage(message.text, sentAt, ctx.gateway.timezone)` (D34). `ctx.gateway.now` is the claim time of the current attempt (src/gateway/index.ts:90), which would move the date of a retry that runs after midnight.
3. **Not an expense.** Return without sending anything.
4. **Rejected.** Send `rejectionText(result.reason)` as a reply, and return.
5. **Categorize.** `match = createMatcher(await listKeywords(db))`. Then, for each item, `category = match(item.description)`.
6. **Store.** `{ entries } = await addMessageEntries(db, { chatId: ctx.gateway.chatId, sourceMessageId: message.message_id, payerUserId: member.userId, byUserId: member.userId, rawText: message.text, parser: "rules", now: ctx.gateway.now, items })`. Each item is `{ amountCentavos, description, spentOn: item.date, categoryId: category.categoryId, categorySource: category.source, checkAmount: item.flags.includes("ambiguous_amount") }`.
7. **Already confirmed.** If any entry has a `confirmationMessageId`, return (D36).
8. **Confirm.** `sentOn = localDate(sentAt, timezone)`. `sent = await reply(ctx, confirmationText(entries, member.displayName, sentOn))`. The payer's name is the sender's first name (D41).
9. **Save the reply's id.** `await attachConfirmation(db, chatId, message.message_id, sent.message_id)` inside `try`. On an error, log exactly `{ event: "capture_confirmation_unsaved", update_id: ctx.update.update_id, message_id: message.message_id, confirmation_message_id: sent.message_id }` with `console.log(JSON.stringify(...))`, as src/gateway/index.ts:199-201 does, and return normally (D37).

`reply(ctx, text)` is a private helper that calls `ctx.reply(text, { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true }, link_preview_options: { is_disabled: true } })` and returns the sent `Message` (D49).

- **`allow_sending_without_reply` (D52).** Without it, Telegram refuses the reply with 400 when the member deleted the message first. Every attempt would then fail, and the update would be parked with its entries unconfirmed. `core`'s `replyTo` (src/core/index.ts:56-60) is private and returns nothing, and changing `core` is out of scope. For the local date and "yesterday", capture uses the parser's `localDate` and `shiftDate` (src/parser/dates.ts:7, 22) (D48).

**What happens when an attempt is repeated.** Every repeat reaches the same state.

| Failure | Next attempt |
|---|---|
| Before step 6 | Parses the same text at the same `sentAt`, so it writes the same entries |
| After step 6, before step 8's send | Step 6 returns the stored rows (`created: false`), and step 8 sends the confirmation built from them |
| Step 8's send | Nothing was sent. Same as the row above |
| Step 9 | Swallowed. The attempt succeeds, so there is no next attempt |
| A later handler, after step 9 | Step 7 sees the stored confirmation id and sends nothing |
| Step 8 with an unknown outcome: a network error or timeout after Telegram accepted the message, or the Worker stopped between step 8 and step 9 | Step 7 finds no stored confirmation id, so step 8 sends the confirmation again. The group sees it twice (D51) |

**Why the confirmation is built from the stored rows.** A repeat's new parse and match could differ from the stored rows if a learned keyword was added in between. The group should see what the ledger holds.

**Why an unknown outcome repeats the confirmation (D51).** A member who sees no ✅ treats the expense as not logged and retypes it (docs/epic.md:694). A missing confirmation therefore costs a duplicate entry, while a repeated confirmation costs one extra message. A "sending" marker written before step 8 would turn the rare repeat into a rare silence, and was rejected.

**Why the failure at step 9 is swallowed (D37).** It follows the gateway's own "success wins over bookkeeping" (src/gateway/index.ts:130-135) and the rule "at most one bot message out" (docs/epic.md:101). The cost is that EB-06 cannot edit that one confirmation in place. The log line records it without message text, a description or a name.

**Statements per message:** 1 (`listKeywords`) + 12 (`addMessageEntries`) + 1 (`attachConfirmation`) = 14 in capture, plus at most 6 in the gateway. That is well under 50.

### Decision 12: The confirmation format (D38, D40)

`src/capture/format.ts` is pure, and exports:

- `formatPesos(centavos: number): string`: `"₱"`, then `Math.floor(centavos / 100)` with a `,` between each group of three digits, then `"." + two digits` when `centavos % 100 !== 0`. Integer arithmetic only.
- `dateLabel(spentOn: string, sentOn: string): string`:
  - `"today"` when the two dates are equal;
  - `"yesterday"` when `spentOn === shiftDate(sentOn, -1)`;
  - otherwise `"<Mon> <d>"` from a fixed English month list (`Jan` … `Dec`, the day without a leading zero), followed by `", <yyyy>"` when the years differ.
- `categoryLabel(categoryId: string): string`: `"<emoji> <shortName>"`, or the id alone when `getCategory` returns nothing.
- `confirmationText(entries: readonly Entry[], payerName: string, sentOn: string): string`:
  - **One entry.** `✅ <amount> · <category> · <payer> · <date>`.
  - **Several entries.** A header `✅ <n> entries · <total> · <payer> · <date>`, then for entry `i` the line `<i+1>. <amount> · <category>`, plus ` · <description>` when the description is not empty. A description longer than 60 characters, counted in code points, is shown as its first 59 followed by `…` (D53). Ten lines of at most about 110 characters, plus the header, stay far below Telegram's 4,096-character limit, which would otherwise fail every attempt with 400.
  - **Amount check.** Any entry's line ends with ` · ⚠️ check amount` when its `checkAmount` is set.
  - **Details.** Lines are joined with `\n`. The date is the first entry's `spentOn` (D40).
- `rejectionText(reason: RejectionReason): string`: see Decision 13.

**Plain text (D38).** Replies are sent with no `parse_mode`, so Telegram reads nothing in them as markup. `<`, `&` and `*` show as typed, and no escape helper is needed. This meets "text typed by members is escaped" (docs/epic.md:387) and the scenario for `<` and `&` (docs/epic.md:410) by construction. Link previews are turned off, so a URL in a description does not unfurl.

### Decision 13: Rejection wording (D39)

| Reason | Reply |
|---|---|
| `multiple_dates` | `❌ Not logged: use one date per message.` |
| `invalid_date` | `❌ Not logged: that date does not exist.` |
| `future_date` | `❌ Not logged: the date is in the future.` |
| `amount_out_of_range` | `❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.` |
| `too_many_items` | `❌ Not logged: 10 items per message at most. Send the rest in another message.` |

`rejectionText` is a `switch` over `RejectionReason` with an exhaustive `never` check, so a new reason in the parser fails the type check.

### Decision 14: Tests, helpers and the stub guard (D43, D46, D47)

**Test-first with stubs (D46).** Section 1 of `tasks.md` creates stubs that export exactly the names in Decision 15. Every function calls `notImplemented()` from `src/gateway/not-implemented.ts`, `CATEGORIES` is `[]` and `SEED_KEYWORDS` is `{}`. The constants carry their real values, because they are data, not behavior. The two migrations and the new `TABLES` entries also arrive in section 1, because the schema is data too. Every test body then runs against real tables, and fails on the stubs rather than in a setup hook. Only the registration of capture waits for section 2.

**Where the project-wide checks run (D61).** `npm run typecheck` covers every file under `src/` and `test/`, and rewrites `worker-configuration.d.ts`. `npm test` runs every test file. So both run only in tasks that have the working tree to themselves: 1.1, 1.2, 1.7 and 2.4. Tasks that run in parallel check their own test files only.

**Stub guard.** Every test asserts an outcome that the stubs or the missing registration cannot produce:

- a returned value, or a stored row;
- a `sendMessage` payload;
- response status 200 from a gateway test, where the stub handler throws and gives 500;
- a non-empty configuration list;
- a `RangeError`, which the stubs' plain `Error` is not.

In section 1, each test fails on a `not implemented` error or on its assertion.

**Tests that pass in section 1.** Every test that task 1.2 adds to `test/helpers.test.ts` and `test/harness.test.ts` passes there, because those tests check the helpers and the schema that 1.2 delivers. A few feature tests also check the schema or behavior that already exists, and these pass in section 1 by design. The reviewer checks that no other feature test passes there.

| Test | File |
|---|---|
| "The table refuses invalid entries written directly" | `test/ledger.test.ts` |
| "A keyword appears once" | `test/keywords.test.ts` |
| "The learned keywords migration inserts no rows" | `test/keywords.test.ts` |
| "Capture adds no command" | `test/entry.test.ts` |

These tests could pass for the wrong reason, so each one pins its cause:

- **The two constraint tests.** A raw `INSERT` with a typo would also be refused. So "The table refuses invalid entries written directly" and "A keyword appears once" each first insert a valid baseline row, which must succeed, and then assert the constraint's message. That is `CHECK constraint failed`, `UNIQUE constraint failed: keyword_map.keyword`, or, for the duplicate entry, `UNIQUE constraint failed: expenses.chat_id, expenses.source_message_id, expenses.item_index`. The duplicate-entry insert leaves out `id`, so only the index `expenses_source_item` can refuse it.
- **The migration test.** It first finds exactly one migration named `0003_categorization.sql` and checks that it creates `keyword_map`. Otherwise an empty lookup would trivially hold no `INSERT`.

**Test files.**

| File | Covers | Harness |
|---|---|---|
| `test/ledger.test.ts` | every scenario of `specs/expense-ledger/spec.md` | `env.DB`, `useCleanTables`, fixed `NOW` with `later(ms)`, rows read back with `SELECT *` into a snake_case row type, as in test/stores.test.ts:16-88 |
| `test/unit/categories.test.ts` | category list, validation, seed invariants, normalization and matching scenarios of `specs/categorization/spec.md` | pure, `it.each` tables with a label column |
| `test/keywords.test.ts` | the learned keywords table scenarios | `env.DB`, rows inserted with raw SQL |
| `test/unit/capture-format.test.ts` | `formatPesos`, `dateLabel`, `categoryLabel`, `confirmationText`, `rejectionText` | pure, entries built by a local `entry(overrides)` helper |
| `test/capture.test.ts` | every scenario of `specs/expense-capture/spec.md` except the three of the requirement "Capture is registered" | full gateway with `createGateway({ modules: [core, capture], now: () => now })` and `signedRequest`, as in test/commands.test.ts:24-77 and test/update-log.test.ts:228-265 |
| `test/entry.test.ts` | the three scenarios of "Capture is registered" | through `src/index.ts` and `src/modules.ts` |
| `test/keywords.test.ts` (extra) | "The learned keywords migration inserts no rows": exactly one `0003_categorization.sql` in `env.TEST_MIGRATIONS` creates `keyword_map`, and none of its queries is an `INSERT`. `useCleanTables` empties the table before each test body runs, so "The table starts empty" alone could not see a seeded row | `env.TEST_MIGRATIONS` |

**Ledger rejections.** The ledger's rejection tests assert `rejects.toThrow(RangeError)`, with the field's name in the message. They run the rejection table against `failingDb(env.DB)` after `failAll()`. A write that sent any statement would then fail with a D1 error rather than a `RangeError`, which proves the scenario "An invalid write never reaches the database". The three malformed-date scenarios also assert `RangeError`. The direct-insert refusals are one `it.each`, over:

- the amount 0;
- the category source `guess`;
- the parser `magic`;
- a `deleted_at` without a `deleted_by`;
- a second row with a stored row's `chat_id`, `source_message_id` and `item_index`, which proves the unique index `expenses_source_item` exists.

**Registration tests (D57).** `test/entry.test.ts` covers the three scenarios of "Capture is registered".

- **"The deployed bot logs an expense".** Set the `sendMessage` result, then send `lunch 250` through `src/index.ts`. Expect one `expenses` row with `confirmation_message_id` 900, and one `sendMessage`.
- **"Capture adds no command".** Assert the `/help` reply's lines with `toEqual(["Commands", "/ping · bot status", "/help · this list"])`. A later change that adds a command updates this list.
- **"Capture is the last message handler".** Assert that `core` comes before `capture` in `modules`, and that `buildRegistry(modules).messages.at(-1)?.module` is `"capture"`. Assert also that capture registers no command, button prefix, edited-message handler or job.

**Helper extensions (D43, D47).**

- **`test/helpers/telegram.ts`** gains `failNext(method, error?)`. The next call to `method` is recorded with `failed: true` and answered with `{ ok: false, error_code, description }` and that HTTP status. The default is `500` and `"Internal Server Error: injected"`. Later calls answer as before. grammY turns the answer into a `GrammyError`. Tests count the sends that succeeded by filtering out `failed` calls. A call that is not failed carries no `failed` key, so the existing `toEqual` assertions on calls are unchanged.
- **`test/helpers/updates.ts`** gains `stickerUpdate(options?)` and `voiceUpdate(options?)` beside `photoUpdate`. They build a message with a `sticker` or a `voice` and no `text`.
- **`test/helpers/db.ts`** gains `failInsideBatch(predicate: (sql, position) => boolean)` on `FailingDb`. Inside `db.batch`, each statement the predicate accepts is replaced by `real.prepare("SELECT json('{')")`, and the batch is sent to D1. SQLite accepts that statement when it prepares it and refuses it when it runs, with "malformed JSON". So the statements before it really run and must be rolled back by D1. `heal()` clears it. Statements outside a batch are unaffected. `TABLES` gains `"expenses"` and `"keyword_map"`, and the doc comments that say "three tables" change with it.
- **`test/helpers.test.ts`** covers each helper. One test shows that D1 itself rolls back a batch: it sends a batch of `INSERT` `settings` key `x` followed by a duplicate `INSERT` of key `x`, expects a rejection, and expects no row `x`. A second test does the same with `failInsideBatch` at position 1.
- **`test/harness.test.ts`** checks that `expenses` and `keyword_map` exist. Its reset test inserts one row into each new table before it checks that every table in `TABLES` is empty.

**Capture test setup.**

- `telegram.setResult("sendMessage", { message_id: 900, date, chat: { id: ALLOWED_CHAT_ID, type: "supergroup" }, text: "" })`. The stub's default result is `true`, which has no `message_id` (test/helpers/telegram.ts:44).
- Messages pass an explicit `date` in seconds.
- "A late attempt keeps the send date" uses a message `date` of `2026-09-29T15:59:00Z`, and a gateway `now` of `2026-09-29T16:00:05Z`. Passing the attempt time to the parser would then give `2026-09-30`.
- The retry tests send the same update twice through one gateway, with `now` advanced by 5 s, as in test/update-log.test.ts:228-244.
- The unsaved-id test passes `{ ...env, DB: failing.db }` with `failWhen((sql) => /^UPDATE expenses\b/i.test(sql) && sql.includes("confirmation_message_id"))`. It spies on `console.log` and expects exactly `{ event: "capture_confirmation_unsaved", update_id, message_id, confirmation_message_id: 900 }`.
- The "handler runs again" test registers `probeModule` after capture, and makes it fail once (test/helpers/probe.ts:34-89).
- "The member's message was deleted" asserts that the reply's `reply_parameters.allow_sending_without_reply` is `true`. The stub cannot delete a message.

### Decision 15: Module interfaces

**`src/ledger/types.ts`**

```ts
export type CategorySource = "keyword" | "learned" | "llm" | "manual" | "default";
export type ParserKind = "rules" | "llm";
export interface NewEntryItem {
  amountCentavos: number; description: string; spentOn: string;
  categoryId: string; categorySource: CategorySource; checkAmount: boolean;
}
export interface NewMessageEntries {
  chatId: number; sourceMessageId: number; payerUserId: number; byUserId: number;
  rawText: string; parser: ParserKind; now: Date; items: NewEntryItem[];
}
export interface Entry {
  id: number; chatId: number; sourceMessageId: number; itemIndex: number;
  confirmationMessageId: number | null; payerUserId: number; amountCentavos: number;
  currency: string; description: string; categoryId: string; categorySource: CategorySource;
  spentOn: string; rawText: string; parser: ParserKind; checkAmount: boolean;
  createdAt: string; createdBy: number; updatedAt: string; updatedBy: number;
  deletedAt: string | null; deletedBy: number | null;
}
export interface AddResult { created: boolean; entries: Entry[] }
export type ChangeResult =
  | { outcome: "changed"; entry: Entry }
  | { outcome: "unchanged"; entry: Entry }
  | { outcome: "not_found" };
export interface EntryChange { id: number; byUserId: number; now: Date }
export interface CategoryChange extends EntryChange { categoryId: string; categorySource: CategorySource }
export interface Period { from: string; to: string }
export interface CategoryTotal { categoryId: string; totalCentavos: number; count: number }
```

**`src/ledger/index.ts`**. It re-exports the types, and exports these constants and functions:

- `MAX_ENTRIES_PER_MESSAGE = 10`, `MIN_AMOUNT_CENTAVOS = 1`, `MAX_AMOUNT_CENTAVOS = 999_999_999` and `CURRENCY = "PHP"`.
- `addMessageEntries(db, input: NewMessageEntries): Promise<AddResult>`
- `attachConfirmation(db, chatId: number, sourceMessageId: number, confirmationMessageId: number): Promise<number>`
- `findEntriesBySourceMessage(db, chatId: number, sourceMessageId: number): Promise<Entry[]>`
- `softDeleteEntry(db, change: EntryChange): Promise<ChangeResult>`
- `restoreEntry(db, change: EntryChange): Promise<ChangeResult>`
- `setEntryCategory(db, change: CategoryChange): Promise<ChangeResult>`
- `findLatestActiveEntry(db, payerUserId: number): Promise<Entry | null>`
- `totalsByCategory(db, period: Period): Promise<CategoryTotal[]>`
- `listEntries(db, period: Period, options?: { includeDeleted?: boolean }): Promise<Entry[]>`
- `countActiveEntriesOn(db, spentOn: string): Promise<number>`

**`src/categories/`**

- `categories.ts` exports `interface Category { id: string; name: string; shortName: string; emoji: string; order: number; countsAsSpending: boolean }` and `CATEGORIES: readonly Category[]`.
- `keywords.ts` exports `SEED_KEYWORDS: Readonly<Record<string, readonly string[]>>`.
- `lookup.ts` exports `FALLBACK_CATEGORY_ID = "other"`, `isCategoryId(id: string): boolean` and `getCategory(id: string): Category | undefined`.
- `normalize.ts` exports `normalizeWords(text: string): string[]` and `normalizeKeyword(text: string): string`.
- `match.ts` exports:
  - `type LearnedSource = "learned" | "llm"`
  - `interface LearnedKeyword { keyword: string; categoryId: string; source: LearnedSource }`
  - `type MatchSource = LearnedSource | "keyword" | "default"`
  - `interface CategoryMatch { categoryId: string; source: MatchSource; keyword: string | null }`
  - `type Matcher = (description: string) => CategoryMatch`
  - `createMatcher(learned: readonly LearnedKeyword[]): Matcher`
- `store.ts` exports `listKeywords(db: D1Database): Promise<LearnedKeyword[]>`.
- `index.ts` re-exports all of the above.

`MatchSource` is a subset of the ledger's `CategorySource`, so capture passes the match's `source` straight through. The two modules share no type import.

**`src/capture/`**

- `format.ts` exports `formatPesos`, `dateLabel`, `categoryLabel`, `confirmationText` and `rejectionText`, with the signatures in Decision 12.
- `index.ts` exports `handleCapture(ctx: BotContext): Promise<void>` and `capture: FeatureModule`.

## Risks / Trade-offs

- **D1 batch rollback has never been exercised here** → Decision 14 proves it twice in test/helpers.test.ts, and once through `addMessageEntries` in the ledger tests.
- **A reply is sent, but a later message handler fails** → Capture is the last message handler (Decision 1). A rejection stores nothing, so a failure after the rejection reply would repeat that reply. Any future message handler MUST be registered before capture (D57).
- **A confirmation id is lost when step 9 fails** → The failure is logged. EB-06 falls back to the message the button is on, and only `/undo` and the edit notice lose in-place editing for that one message.
- **An update is parked after 3 failed sends** → The entries stay stored and unconfirmed. `/ping` lists the parked update, and the member sees no ✅ and can check with `/today` later (EB-08). A deleted source message and an over-long reply, the two ordinary causes of a send that fails every time, are prevented (D52, D53).
- **A send with an unknown outcome repeats the confirmation** → Accepted, because a missing ✅ makes a member retype the expense (D51). It is rare: it needs a network failure after Telegram accepted the send, or a Worker stopped mid-attempt.
- **Wrong entries cannot be removed from the chat until EB-06** → The parser logs any message with an amount and no `?`, such as `250` or `see you in 10 mins`. Until EB-06 adds Undo, a wrong entry can only be removed through the D1 console. The epic starts daily use at wave 2, before EB-06 in wave 3 (docs/epic.md:212-213), so this is accepted (D54). Holding the deploy until EB-06 ships is the alternative.
- **`jollibee's` does not match `jollibee`** → Accepted. Characters inside a word stay, so `7-eleven` and `s&r` work. A learned keyword covers a common case.
- **Folding accents stores `pina` for `piña`** → Accepted. It is visible only in the keyword backup.
- **Plain text still turns `@name` and URLs into links** → The text still shows as typed. Previews are off.
- **A GrammyError 429 uses one of the 3 attempts** → Accepted. At two members' volume this is unlikely.
- **No test profile exists** → `.claude/testing/profile.json` is missing. Without it, ship skips its inter-wave and final verification, and `--continue` refuses to start. Task 2.4's own `npm test` and type check are then the only whole-suite gate. Running `/interlock:fix-tests` once, which is outside this change, restores the independent final check.

## Migration Plan

1. Merge the change.
2. Apply the migrations to the remote database first, with `npm run db:migrate:remote`. It applies `0002` and `0003`, as docs/setup.md:65-71 describes (D50).
3. Deploy with `npm run deploy`. A Worker deployed before its migrations would fail every text message on "no such table", then retry and park it.
4. Send `lunch 250` in the group and check for the ✅ reply.

Until EB-06 ships, a wrong entry can only be removed in the D1 console, with an `UPDATE` that sets `deleted_at` and `deleted_by` (D54).

**Rollback.** Remove `capture` from `src/modules.ts` and deploy. The tables stay. They are additive, and nothing else reads them yet.
