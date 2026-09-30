## Why

Logging only sticks if the bot accepts what members naturally type. Both reference parsers misread common peso formats such as `1,500` and `1.5k`, log one entry where two were typed, and cannot backdate (docs/epic.md, section 9). The capture flow (EB-05) needs a parser that is written and tested for these cases before it can store anything.

## What Changes

- **A parser library.** One pure function, `parseExpenseMessage`, takes the message text, the current time and the household timezone. It has no database access, no network access and writes no log lines.
- **Three results.** The parser returns a list of parsed items, "not an expense", or a rejection with a reason code. It never throws because of the text, so an odd message can never make the gateway retry or park an update.
- **Amount formats.** `250`, `250.50`, `1,500`, `1.5k`, `₱250`, `P250` and `php 250`, before or after the description. Amounts are returned as whole centavos. A valid amount is above 0 and below 10,000,000 pesos.
- **Several expenses in one message.** Items are separated by new lines, commas, semicolons, `and` or `+`. The comma inside `1,500` is not a separator. At most 10 items.
- **Several numbers in one item.** The number with a currency mark wins, otherwise the last number, and the item is flagged `ambiguous_amount` with low confidence.
- **Numbers that are not amounts.** Times, ordinals, percentages, plain numbers of 8 or more digits, and numbers joined to letters or symbols.
- **Dates.** The default is today in the household timezone. The parser understands `today`, `yesterday`, `ngayon`, `kanina`, `kahapon`, `kagabi`, `3 days ago`, `sep 27`, `27 sep` and `2026-09-27`. One date applies to every item in the message. A date without a year means the nearest such date in this year or last year.
- **Rejections.** A future date, an invalid date, two different dates, an amount out of range, or more than 10 items. The whole message is rejected and no item is returned.
- **Questions and commands** are not expenses.
- **Clarifications of the epic.** Each is a recorded decision in `decisions.md` and is explained in `design.md`.
  - The rule "numbers of 8 or more digits are not amounts" covers plain digit runs only, so `25,000,000` is still rejected as out of range, as the epic's scenario requires (D10).
  - A separator splits the message only when each side holds an amount, so `mac and cheese 250` is one item (D11).
  - A message with no amount is never rejected. `see you oct 15` is not an expense, even though the date is in the future (D9).
  - The item is not flagged when exactly one number carries a currency mark, as in `dinner for 2 ₱600` (D12).
  - Any message that contains `?` is a question (D13).
  - The parser enforces the limit of 10 items. The epic lists that reason under EB-05 (D8).

### Non-goals

- Reading messages from Telegram, replying, and wording the rejection replies (EB-05).
- Categories and keyword matching (EB-04), and storage (EB-03).
- Any LLM call (EB-13).
- Payment methods. Words such as `gcash` stay in the description.
- Numeric dates such as `9/27`, which collide with quantities such as `1/2 kilo`.
- A year in month-name dates, month names in Filipino, and ordinal days such as `sep 27th`.
- Currency marks after the number, such as `250 pesos`. The word stays in the description (D14).
- Any currency other than the peso.

## Capabilities

### New Capabilities

- `expense-parsing`: turning the text of one chat message into expense items with an amount in centavos, a description, a date, flags and a confidence, or into "not an expense", or into a rejection with a reason.

### Modified Capabilities

None. The parser registers nothing with the gateway, so no requirement of `bot-gateway` changes.

## Impact

- **Code.** A new directory `src/parser/` with six files, and five new test files under `test/unit/`. No existing file is changed, including the four shared files (`src/modules.ts`, `src/index.ts`, `wrangler.jsonc`, `migrations/`).
- **Database.** None. Migration number `0002` stays reserved for EB-03.
- **Dependencies.** None added. Dates use the runtime's `Intl` support.
- **Configuration.** None. The caller passes the timezone, which the gateway already reads from `HOUSEHOLD_TZ`.
- **Behavior of the deployed bot.** Unchanged. Nothing calls the parser until EB-05.
- **Later issues.** EB-05 calls the parser and words the replies. EB-13 reads the confidence and the flags.
