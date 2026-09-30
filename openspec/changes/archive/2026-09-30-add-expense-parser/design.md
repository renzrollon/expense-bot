## Context

See `proposal.md` for motivation and `specs/expense-parsing/spec.md` for the required behavior. This document explains how to build it. The findings behind it are in `.claude/handoff/explore-add-expense-parser-20260930-000026.md`, and every decision id (D1 to D39) refers to a row in `decisions.md`.

**What exists**

- The gateway gives a handler the current time as a `Date` and a timezone it has already validated (`src/gateway/registry.ts:46-56`, `src/gateway/config.ts:74-84`). These are the parser's two inputs besides the text.
- A handler that throws fails the attempt. Telegram redelivers, and after 3 failures the update is parked (`src/gateway/index.ts:110-128`). A parser that threw on odd text would park ordinary chat.
- Plain text reaches no handler today, so the bot is silent (`src/gateway/bot.ts:57-60`). This change does not alter that.
- All tests, pure ones included, run inside the Workers runtime (`vitest.config.mts:15-32`).

**Constraints**

- The free plan allows 10 ms of CPU time per request. A Telegram message holds at most 4,096 characters.
- grammY is the only runtime dependency, and pins are exact.
- The TypeScript target is `es2024`, which has no types for `Temporal`.
- Log lines never hold message text.

## Goals / Non-Goals

**Goals**

- The 17 scenario seeds of the epic pass, and so does every scenario of the spec.
- Each group of rules lives in one pure function with its own table and its own test file: reading a number, calendar arithmetic, splitting words, and finding date phrases.
- The work is linear in the length of the text.
- No existing file changes.

**Non-Goals**

- A general natural-language parser. The vocabulary is fixed and short.
- Guessing the intent behind a bare quantity. `dinner for 2 and drinks 600` gives two items, and the confirmation in EB-05 is what shows it.
- A shared date helper for other modules. `src/parser/dates.ts` serves the parser. A later issue that needs the same functions can import them or move them in its own change.

## Decisions

### 1. Layout, and what is not touched (D1, D33, D38)

```
src/parser/types.ts      the result types
src/parser/amounts.ts    one word of text to centavos
src/parser/dates.ts      the local date and calendar arithmetic
src/parser/words.ts      the text to words and separators
src/parser/phrases.ts    the date phrases among the words
src/parser/index.ts      parseExpenseMessage: the steps, parts, items, rejections
test/unit/parser-amounts.test.ts
test/unit/parser-dates.test.ts
test/unit/parser-words.test.ts
test/unit/parser-phrases.test.ts
test/unit/parser.test.ts
```

The parser registers no handler, so it adds no line to `src/modules.ts`. None of the four shared files changes. EB-05 adds the registration line when it adds the capture handler.

**Why six files (D38).** The task rules make work on one file one checkbox. The first draft of this design had word splitting and date phrases inside `index.ts`, which made one task hold most of the behavior and left both without a test of their own. The artifact review reported it. Now `amounts.ts`, `dates.ts` and `words.ts` depend on nothing, `phrases.ts` depends on `dates.ts`, and `index.ts` depends on the other four. A failing test points at one file.

**Alternatives.** One file `src/parser.ts` was rejected for the reason above. A place inside `src/capture/` was rejected because EB-05 owns that directory and runs in a later wave.

**Invariant sweep (D33).** The parser introduces two canonical forms: an amount as whole centavos and a date as `YYYY-MM-DD` text. No existing code reads either, so there is no reader to update. Each form is produced in exactly one place: text becomes centavos only in `amounts.ts`, and a time becomes a local date only in `dates.ts`. Later issues read the parser's output and do not convert again.

### 2. Contract (D2, D3, D5, D6, D7, D8, D27, D31)

```ts
parseExpenseMessage(text: string, now: Date, timezone: string): ParseResult
```

The result is a union with a `kind` field, in the style of `Decision` in `src/gateway/classify.ts:14-17`. The types are in Decision 11.

- **Plain values in, plain values out.** The parser does not take a `BotContext`, so it can be tested without the gateway, and EB-13 can call it too.
- **The date is `YYYY-MM-DD` text (D5).** Two such texts compare correctly as text, so "after today" is a text comparison.
- **Confidence is `high` or `low` (D6).** It is `low` when the item has a flag. `ambiguous_amount` is the only flag. `flags` is a list so that a later issue can add a flag without changing the shape.
- **A rejection holds a reason code and nothing else (D7).** EB-05 words the reply. If it needs the date or the amount for its text, a field can be added later without breaking a caller.
- **The limit of 10 items is the exported constant `MAX_ITEMS` (D8).** The parser enforces it because the count is a property of the text, and the caller should not have to count again.
- **No log lines (D27).**

**Never throwing (D3).** The steps that read the text run inside one `try` block whose `catch` returns "not an expense", as `classifyUpdate` does (`src/gateway/classify.ts:28-38`). Nothing in those steps is expected to throw, so no test can reach the `catch`. It is verified by review.

**Preconditions (D31).** The parser computes today's date first, before it looks at the text and outside the `try` block. `Intl.DateTimeFormat` throws `RangeError` for a timezone it does not know and for an invalid `Date`, and the parser lets that error pass. Computing the date first makes the behavior the same for every text.

**Alternative.** Throwing a named error for a rejection was rejected. A rejection is an expected outcome, and a throw would reach the gateway's retry logic.

### 3. The steps, in a fixed order (D9, D13)

| Step | What it does | Where | Result when it ends the run |
|---|---|---|---|
| 1 | Compute today from `now` and `timezone` | `dates.ts` | throws `RangeError` |
| 2 | Look at the raw text: empty, starts with `/`, or holds `?` | `index.ts` | not an expense |
| 3 | Split the text into words and separators (Decision 4) | `words.ts` | |
| 4 | Find date phrases and take their words out (Decision 6) | `phrases.ts` | |
| 5 | Read each remaining word as a number (Decision 5) | `amounts.ts` | |
| 6 | No amount anywhere | `index.ts` | not an expense |
| 7 | Check the dates (Decision 9) | `index.ts` | rejection |
| 8 | Build the parts and join those without an amount (Decision 8) | `index.ts` | |
| 9 | Choose one amount for each part and check its range | `index.ts` | rejection |
| 10 | Count the items | `index.ts` | rejection |
| 11 | Build the items | `index.ts` | items |

**Dates before amounts.** Step 4 runs before step 5 so that the `3` in `3 days ago` and the `27` in `sep 27` are never read as amounts.

**"Not an expense" before any rejection (D9).** Step 6 comes before step 7. A chat line such as `see you oct 15` names a future date but holds no amount, and the bot must stay silent on it.

**Questions and commands (D13).** A `?` anywhere makes the message a question. The gateway already keeps commands away from message handlers (`src/gateway/bot.ts:71-75`), but a caption or a later caller could still pass one, so the parser checks for itself.

### 4. Words and separators (D15, D23, D35, D39)

`splitWords(text)` in `words.ts` returns a list of tokens. A token is a word, a separator, or the word `and`.

**Terms.** A *word* is a run of characters between white space and separators. A *separator* is a new line, `,`, `;` or `+`. The word `and`, in any letter case, separates too, and has a token kind of its own because it can return to the description (Decision 8). A *part* is the words between two separating tokens. The *bare form* of a word is the word without the punctuation at its ends that is ignored (D35): `(`, `[`, `{` and opening quotes in front, and `)`, `]`, `}`, closing quotes, `.`, `!` and `:` behind. Every such character at either end is removed, not only the first. The bare form is used to read a number or a date word. The description uses the word as typed.

**White space and new lines (D39).** White space is what the pattern class `\s` matches, which includes the tab and the non-breaking space. A new line is `\r\n`, `\n` or `\r`. Each is one separator, and its token text is `\n`.

**One walk over the text.**

1. Before the walk, one pattern finds the grouped numbers, so that their commas are kept: 1 to 3 digits, then one or more groups of a comma and exactly 3 digits, with no digit directly before or after (D23).
2. The walk goes through the text once. A new line ends the word and adds a separator. Other white space ends the word. `;` and `+` end the word and add a separator. A comma does the same unless it lies inside a grouped number. Every other character is added to the word.
3. A word whose bare form is `and`, in any letter case, becomes an `and` token that keeps its text as typed.

Each token keeps its original text. Nothing is lower-cased in place. Vocabulary is compared on a lower-cased copy of the bare form (D15).

| Text | Tokens |
|---|---|
| `lunch 250` | word `lunch`, word `250` |
| two spaces, `lunch`, a tab, `250`, two spaces | word `lunch`, word `250` |
| `lunch`, a non-breaking space, `250` | word `lunch`, word `250` |
| the empty text | none |
| `grab 180, lunch 250` | word `grab`, word `180`, separator `,`, word `lunch`, word `250` |
| `grab 180,lunch 250` | the same five tokens |
| `groceries 1,500.50` | word `groceries`, word `1,500.50` |
| `₱1,500, grab 180` | word `₱1,500`, separator `,`, word `grab`, word `180` |
| `25,000,000` | word `25,000,000` |
| `snacks 50,75` | word `snacks`, word `50`, separator `,`, word `75` |
| `lunch 1,5000` | word `lunch`, word `1`, separator `,`, word `5000` |
| `1234,567` | word `1234`, separator `,`, word `567` |
| `a;b+c` | word `a`, separator `;`, word `b`, separator `+`, word `c` |
| `a`, `\n`, `b` | word `a`, separator `\n`, word `b` |
| `a`, `\r\n`, `b` | word `a`, one separator `\n`, word `b` |
| `,,` | separator `,`, separator `,` |
| `mac and cheese` | word `mac`, and `and`, word `cheese` |
| `Mac AND cheese` | word `Mac`, and `AND`, word `cheese` |
| `brand new sandals` | three words |
| `lunch (250).` | word `lunch`, word `(250).` with the bare form `250` |
| `kahapon: lunch` | word `kahapon:` with the bare form `kahapon`, word `lunch` |
| `lunch - 250` | word `lunch`, word `-` with the bare form `-`, word `250` |
| `:` | word `:` with an empty bare form |
| `10:30` | word `10:30` with the bare form `10:30` |

Where the table gives no bare form, it is the same as the text.

**Why tokens and not passes of patterns over the raw text.** Passes interfere with each other: the comma in `1,500` against the comma separator, the numbers inside date phrases, and removing `250` from `250 lunch 250` by text replacement. Tokens keep their position, so the parser removes exactly the word it used. This is the explore brief's option P1. Option P2 is the style of both reference parsers, and their failures are in section 9 of the epic.

**Linear time.** Every pattern is anchored to one word or is a single scan without a repetition inside a repetition. The spec scenario "Longest message" parses 4,096 characters.

### 5. Reading a number (D10, D14, D20, D21, D22, D28, D32)

`readAmount(word)` in `amounts.ts` takes the bare form of one word and returns one of three readings: an amount in centavos, out of range, or not an amount. The first two also say whether the number carries a currency mark.

**Shape.** A word is a number when its whole text is, in this order: an optional minus sign, an optional mark (`₱`, `php` or `p`, in any letter case), digits that are either plain or grouped by thousands, an optional decimal point with one or more digits, and an optional `k`. Only the digits `0` to `9` count. Anything else is not an amount. That one rule covers times, ordinals, percentages, units, fractions, tags and links (D21), because none of them has that shape.

**Checks, in order.**

1. The word does not have the shape: not an amount.
2. The word is only digits, and there are 8 or more: not an amount (D10).
3. Apply `k` by moving the decimal point 3 places to the right. More than 2 decimal digits remain, counted as written: not an amount (D22).
4. A minus sign: out of range (D20).
5. The whole part, without leading zeros, has 8 or more digits: out of range. Every such number is 10,000,000 or more, so it is never converted (D32).
6. Convert: whole part times 100, plus the decimal part padded to 2 digits. Zero: out of range. Otherwise: an amount.

**Digits are counted as written (D22).** `250.500` and `1.500` have 3 decimal digits and are not amounts, although their value is a whole number of centavos. The first draft accepted them, which read `groceries 1.500` as ₱1.50. A member who writes the thousands separator as a period would get an entry that is wrong and looks plausible. Silence is the safer mistake.

**No fractions in arithmetic (D32).** The conversion works on digits. `1.15 * 100` in floating point is `114.99999999999999`, and the ledger rejects an amount that is not a whole number of centavos.

| Word | Reading |
|---|---|
| `250` | amount 25000 |
| `250.5`, `250.50` | amount 25050 |
| `1.15` | amount 115 |
| `0.01` | amount 1 |
| `007` | amount 700 |
| `1,500` | amount 150000 |
| `1,500.50` | amount 150050 |
| `9,999,999.99` | amount 999999999 |
| `1234567` | amount 123456700 |
| `1.5k`, `1.5K`, `1.50000k` | amount 150000 |
| `1.2345k` | amount 123450 |
| `₱250`, `P250`, `p250`, `php250`, `PHP250` | amount 25000, marked |
| `₱1.5k` | amount 150000, marked |
| `0`, `0.00` | out of range |
| `-250` | out of range |
| `-₱250` | out of range, marked |
| `10,000,000`, `25,000,000` | out of range |
| `10000k` | out of range |
| `12345678.50` | out of range |
| `₱12345678` | out of range, marked |
| `12345678`, `09171234567` | not an amount |
| `45.678`, `0.001`, `250.500`, `1.500` | not an amount |
| `1.234567k`, `1.500000k` | not an amount |
| `5pm`, `10:30`, `15th`, `20%`, `5kg`, `x2`, `1/2`, `#123` | not an amount |
| `1,50`, `12,34,567`, `1,5000` | not an amount |
| `.5`, `5.`, `1e3`, `0x10`, `２５０` | not an amount |
| the empty text, `k`, `₱`, `php`, `-` | not an amount |

**Marks with a space (D14).** `php 250` and `₱ 250` arrive as two words. When a word whose bare form is `₱` or `php` is directly followed by a number without a mark, `index.ts` reads the two joined together, so `php 12345678` is a marked number and is out of range. The mark word is used up with the number. A lone `P` is never a mark, because it is too easily a word. A currency word after the number is not a mark: the epic lists leading forms only, and payment words stay in the description.

**Times and percentages with a space (D28).** A number without a mark that is directly followed by `am`, `pm` or `%` is not an amount. Both words stay in the description.

"Directly followed" means the next token is that word, with no separating token between them.

### 6. Date phrases (D16, D19, D24, D30, D36)

`findDatePhrases(tokens, today)` in `phrases.ts` returns the tokens that are not part of a date phrase, and one date for each phrase it found. It goes through the tokens from left to right. At each word it tries these rules in order, on lower-cased bare forms, and the first that applies uses up its words:

| # | Words | Meaning |
|---|---|---|
| 1 | `today`, `ngayon`, `kanina` | today (D24) |
| 2 | `yesterday`, `kahapon`, `kagabi` | today minus 1 day (D24) |
| 3 | `N`, then `day` or `days`, then `ago` | today minus N days. N is 1 to 4 plain digits and at least 1 (D30) |
| 4 | a day number, then a month name | the nearest such date (Decision 7) |
| 5 | a month name, then a day number | the nearest such date (Decision 7) |
| 6 | text of the shape `YYYY-MM-DD` | that date, when it is real (D36) |

The words of one phrase follow each other directly, with no separating token between them.

**Month names (D16).** `jan`, `feb`, `mar`, `apr`, `may`, `jun`, `jul`, `aug`, `sep`, `sept`, `oct`, `nov`, `dec`, and the twelve full English names. A day number is 1 or 2 plain digits with a value from 1 to 31. A month name that has no day number beside it is an ordinary word, so `jan 500` is an item with the description `jan`. Rule 4 comes before rule 5, so in `12 may 13` the day is 12.

**`kagabi` means yesterday.** It is "last night". Typed after midnight it still means the calendar day before.

**Each phrase gives a date or `null`.** `sep 31` and `2026-02-30` are phrases that are not real dates. They give `null` and still use up their words.

**What is left out.** A year after a month name, month names in Filipino, ordinal days and numeric dates such as `9/27`. They are listed as non-goals in the proposal.

**Same date twice (D19).** `findDatePhrases` returns one entry for each phrase. `index.ts` reduces them to the distinct ones. Two phrases that give the same date are one date. A `null` differs from every other entry, including another `null`.

In this table today is `2026-09-29`. "Left" shows the text of the tokens that remain.

| Text | Dates | Left |
|---|---|---|
| `lunch 250` | none | `lunch`, `250` |
| `today lunch`, `ngayon lunch`, `kanina lunch` | `2026-09-29` | `lunch` |
| `yesterday lunch`, `kahapon lunch`, `kagabi lunch` | `2026-09-28` | `lunch` |
| `KAHAPON lunch`, `(kahapon) lunch`, `kahapon: lunch` | `2026-09-28` | `lunch` |
| `lunch 250 kahapon` | `2026-09-28` | `lunch`, `250` |
| `3 days ago lunch` | `2026-09-26` | `lunch` |
| `1 day ago lunch` | `2026-09-28` | `lunch` |
| `9999 days ago lunch` | `1999-05-15` | `lunch` |
| `0 days ago lunch` | none | all four words |
| `10000 days ago lunch` | none | all four words |
| `3 days lunch` | none | all three words |
| `sep 27 meralco`, `27 sep meralco` | `2026-09-27` | `meralco` |
| `september 27`, `Sept 27`, `SEP 27`, `sep 27.` | `2026-09-27` | none |
| `sep 07` | `2026-09-07` | none |
| `12 may 13` | `2026-05-12` | `13` |
| `oct 15 rent` | `2026-10-15` | `rent` |
| `jan 500`, `sep 32`, `sep 0` | none | both words |
| `₱27 sep`, `sep 27th` | none | both words |
| `sep`, separator `,`, `27` | none | all three tokens |
| `sep 31 lunch`, `feb 29 lunch` | `null` | `lunch` |
| `2026-09-27 lunch` | `2026-09-27` | `lunch` |
| `2026-02-30 lunch`, `2026-13-01 lunch` | `null` | `lunch` |
| `2026-9-27 lunch` | none | both words |
| `kahapon lunch`, separator `,`, `sep 20 grab` | `2026-09-28`, `2026-09-20` | `lunch`, separator `,`, `grab` |
| `kahapon lunch`, separator `,`, `sep 28 grab` | `2026-09-28`, `2026-09-28` | `lunch`, separator `,`, `grab` |

### 7. Calendar arithmetic (D4, D5, D17, D18, D36)

`dates.ts` has four functions. None of them knows about words.

| Function | Result |
|---|---|
| `localDate(now, timezone)` | today in that timezone, as `YYYY-MM-DD` |
| `shiftDate(date, days)` | the date that many days later, or earlier when negative |
| `isRealDate(year, month, day)` | whether that date exists |
| `nearestDate(month, day, today)` | the nearest such date, or `null` when there is none |

**The local date (D4).** `Intl.DateTimeFormat` with `timeZone`, `year: "numeric"`, `month: "2-digit"` and `day: "2-digit"`, the locale `en-US` and the Gregorian calendar, read through `formatToParts`. Reading the parts does not depend on the order in which a locale prints them. The same API is already used in `src/core/index.ts:63-71`.

**Arithmetic on calendar dates.** A date is year, month and day. Shifting and measuring go through UTC midnight of that date, so no daylight-saving rule is involved. Years are set with `setUTCFullYear`, because `Date.UTC` maps the years 0 to 99 to 1900 to 1999.

**A real date (D36)** is one that comes back unchanged after it is set and read again.

**The nearest date (D18).** The candidates are the month and day in the year of `today` and in the year before. Those that are not real are dropped. The one with the smallest distance in days wins. On a tie the earlier one wins. The function returns a future date when that is the nearest. The caller rejects it.

**No limit in the past (D17).** The epic names three date problems, and "too old" is not one of them.

| Call | Result |
|---|---|
| `localDate(2026-09-29T00:00:00Z, Asia/Manila)` | `2026-09-29` |
| `localDate(2026-09-29T15:59:59.999Z, Asia/Manila)` | `2026-09-29` |
| `localDate(2026-09-29T16:00:00Z, Asia/Manila)` | `2026-09-30` |
| `localDate(2026-12-31T16:30:00Z, Asia/Manila)` | `2027-01-01` |
| `localDate(2026-09-29T00:00:00Z, America/Los_Angeles)` | `2026-09-28` |
| `localDate(2026-09-29T00:00:00Z, UTC)` | `2026-09-29` |
| `localDate(an invalid Date, Asia/Manila)` | throws `RangeError` |
| `localDate(2026-09-29T00:00:00Z, Mars/Olympus)` | throws `RangeError` |
| `shiftDate(2026-09-29, 0)` | `2026-09-29` |
| `shiftDate(2026-09-29, -1)` | `2026-09-28` |
| `shiftDate(2026-09-29, -30)` | `2026-08-30` |
| `shiftDate(2026-09-29, -9999)` | `1999-05-15` |
| `shiftDate(2027-01-01, -1)` | `2026-12-31` |
| `shiftDate(2024-03-01, -1)` | `2024-02-29` |
| `shiftDate(2026-03-01, -1)` | `2026-02-28` |
| `isRealDate(2024, 2, 29)` | true |
| `isRealDate(2026, 2, 29)`, `(2026, 9, 31)`, `(2026, 13, 1)`, `(2026, 0, 1)`, `(2026, 1, 0)` | false |
| `isRealDate(50, 1, 1)` | true |
| `nearestDate(9, 27, 2026-09-29)` | `2026-09-27` |
| `nearestDate(9, 29, 2026-09-29)` | `2026-09-29` |
| `nearestDate(1, 1, 2026-09-29)` | `2026-01-01` |
| `nearestDate(10, 15, 2026-09-29)` | `2026-10-15`, 16 days ahead against 349 back |
| `nearestDate(12, 30, 2026-09-29)` | `2026-12-30`, 92 days ahead against 273 back |
| `nearestDate(12, 30, 2027-01-02)` | `2026-12-30`, 3 days back against 362 ahead |
| `nearestDate(12, 31, 2028-07-01)` | `2027-12-31`, a tie at 183 days |
| `nearestDate(2, 29, 2025-03-05)` | `2024-02-29` |
| `nearestDate(2, 29, 2024-03-01)` | `2024-02-29` |
| `nearestDate(2, 29, 2026-09-29)` | `null` |
| `nearestDate(9, 31, 2026-09-29)` | `null` |

**Alternatives.** `Temporal` has no types under the current target and is not proven in the runtime. `date-fns-tz` and `luxon` would add a runtime dependency for four small functions.

### 8. Parts and items (D11, D12, D29, D34)

**Parts.** After the date words are taken out, the separators and the `and` tokens split the remaining words into parts. An empty part is dropped.

**Joining (D11).** A part without an amount joins the part after it. When it is the last part, it joins the part before it. The rule is applied from left to right until every part holds an amount, so in `a, b, c 100` all three words end in one part. "An amount" here means a reading of "amount" or "out of range". The rule exists because the epic makes `and` and the comma separators, and both also occur inside descriptions. Without it, `mac and cheese 250` would give an item with no amount.

**Choosing the amount (D12, D34).**

| Amounts in the part | Chosen | Flag |
|---|---|---|
| one | that one | none |
| several, exactly one marked | the marked one | none |
| several, two or more marked | the last marked one | `ambiguous_amount` |
| several, none marked | the last one | `ambiguous_amount` |

The epic's sentence on several numbers can be read as "flag whenever there are several". This design flags only when the parser had to guess. A member who writes `₱600` has said which number is the amount. The reading is listed at the checkpoint because a member will notice it.

**Range.** Only the chosen amount is checked. A number that stays in the description is text.

**The description (D29).** It is made of the words of the part that were not used up, as typed, in order, joined by single spaces. The words used up are the chosen amount and, when it had one, its separate mark word. Words made only of hyphens, dashes or colons are dropped, so `lunch - 250` gives `lunch`. No other word is changed, and nothing is escaped: EB-05 escapes text when it builds a reply (docs/epic.md:388). When two parts were joined, a punctuation separator between them is dropped, and an `and` token between them is kept as a word with its text as typed.

### 9. Rejections (D7, D8, D9, D19)

The checks run in this order, and the first that fails gives the reason:

1. Two or more distinct dates: `multiple_dates`.
2. The one date is `null`: `invalid_date`.
3. The one date is after today: `future_date`.
4. A chosen amount is out of range: `amount_out_of_range`.
5. More than `MAX_ITEMS` items: `too_many_items`.

The order is fixed so that a message always gets the same reason. Date problems come first because the date applies to the whole message.

A rejection returns no item. EB-05 logs nothing for a rejected message, and the ledger stores the items of one message together or not at all.

### 10. Tests (D25, D26, D37)

The tests run in the Workers runtime like every other test, so the date functions are tested against the `Intl` data that production uses.

| File | Covers |
|---|---|
| `test/unit/parser-amounts.test.ts` | `readAmount`: every row of the table in Decision 5 |
| `test/unit/parser-dates.test.ts` | `localDate`, `shiftDate`, `isRealDate`, `nearestDate`: every row of the table in Decision 7 |
| `test/unit/parser-words.test.ts` | `splitWords`: every row of the table in Decision 4 |
| `test/unit/parser-phrases.test.ts` | `findDatePhrases`: every row of the table in Decision 6 |
| `test/unit/parser.test.ts` | `parseExpenseMessage`: one test for each spec scenario, named after it |

- **Style.** `it.each` tables with a label column, as in `test/unit/classify.test.ts:58-66`. A spec scenario that lists several messages is one table. The `describe` blocks of `parser.test.ts` are named after the requirements.
- **Time (D37).** `const NOW = new Date("2026-09-29T00:00:00.000Z")` is passed as an argument. That is Tuesday 2026-09-29 at 08:00 in Manila, the day the epic's scenario seeds assume. Scenarios that name another time pass that time. No test uses fake timers.
- **Timezone.** `HOUSEHOLD_TZ` from `test/helpers/constants.ts`.
- **Whole results.** A test asserts the complete returned value with `toEqual`, so a field that is wrong or extra fails the test.
- **Phrase tests build their tokens by hand (D38).** They use two small local helpers, one for a word with its bare form and one for a separator. They do not call `splitWords`, so a defect in `words.ts` cannot fail the phrase tests.
- **The two scenarios verified by review** have no test.
- **Ten and eleven items.** The test builds the message from a list, for example `item1 1, item2 2` and so on.

**The stub guard (D26).** The check of the leading test section is skipped by the ship run, so nobody is told when a test already passes. Every test therefore calls a parser function and asserts a returned value or an error of the class `RangeError`. The stubs throw a plain `Error` with the message `not implemented`, so a stub can satisfy neither. `amounts.ts`, `dates.ts`, `words.ts`, `phrases.ts` and `index.ts` start as stubs. `types.ts` is complete from the first task, because it holds types only.

### 11. Module interfaces

The tests are written before the implementation, so they need names to import. The stubs of task 1.1 export exactly these names.

```ts
// src/parser/types.ts — complete from task 1.1
type Flag = "ambiguous_amount";
type Confidence = "high" | "low";
type RejectionReason =
  | "multiple_dates"
  | "invalid_date"
  | "future_date"
  | "amount_out_of_range"
  | "too_many_items";
interface ParsedItem {
  amountCentavos: number;   // whole number, 1 to 999999999
  description: string;      // may be empty
  date: string;             // YYYY-MM-DD
  flags: Flag[];
  confidence: Confidence;
}
type ParseResult =
  | { kind: "items"; items: ParsedItem[] }   // 1 to MAX_ITEMS items
  | { kind: "not_expense" }
  | { kind: "rejected"; reason: RejectionReason };

// src/parser/amounts.ts
type AmountReading =
  | { kind: "amount"; centavos: number; marked: boolean }
  | { kind: "out_of_range"; marked: boolean }
  | { kind: "not_amount" };
function readAmount(word: string): AmountReading;

// src/parser/dates.ts
function localDate(now: Date, timezone: string): string;   // throws RangeError
function shiftDate(date: string, days: number): string;
function isRealDate(year: number, month: number, day: number): boolean;
function nearestDate(month: number, day: number, today: string): string | null;

// src/parser/words.ts
type Token =
  | { kind: "word"; text: string; bare: string }   // text as typed, bare form in its original casing
  | { kind: "separator"; text: "\n" | "," | ";" | "+" }
  | { kind: "and"; text: string };                 // the word and, as typed
function splitWords(text: string): Token[];

// src/parser/phrases.ts
interface DatePhrases {
  rest: Token[];                // the tokens that are not part of a date phrase, in order
  dates: (string | null)[];     // one entry for each phrase, in order. null is not a real date
}
function findDatePhrases(tokens: Token[], today: string): DatePhrases;

// src/parser/index.ts
const MAX_ITEMS = 10;
function parseExpenseMessage(text: string, now: Date, timezone: string): ParseResult;
// index.ts also re-exports the types of types.ts
```

The stubs import `notImplemented` from `src/gateway/not-implemented.ts`. The finished files do not import it, so the parser ends with no import from the gateway.

## Risks / Trade-offs

- **Chat with a number is logged** → `see you in 5` becomes an item of ₱5. The epic accepts this and relies on the confirmation and on undo. Until EB-06 there is no undo, so the group should be kept for expenses, as the epic says.
- **`and` splits a quantity from its amount** → `dinner for 2 and drinks 600` gives ₱2 and ₱600, with no flag. The epic chose `and` as a separator. The confirmation shows both lines.
- **A month name takes the only number** → `jun 20` is read as June 20 and is not an expense. A missing confirmation is the signal the epic already describes.
- **Any `?` silences the message** → `lunch 250?` is not logged (D13). Silence is the safer of the two mistakes.
- **A dash joined to the amount rejects the message** → `lunch -250` is read as a negative amount (D20). The member gets a reason and types it again with a space.
- **A bug in the parser shows as silence, not as a parked update** → The `catch` of Decision 2 returns "not an expense". The member sees no confirmation and types again. The scenario "Unusual text does not throw" and the tables keep the chance small.
- **`formatToParts` has not run in this runtime before** → The date tests run in the Workers runtime and pin both sides of midnight in Manila.
- **A slow pattern could exceed the CPU limit** → Patterns are anchored to one word, and one test parses 4,096 characters.
- **The time passed in is the time of the attempt, not of the message** → On a retry just after midnight, "today" is the next day. The parser takes the time as an argument, so EB-05 can pass the message's own time instead.
- **The leading test section is not checked by the ship run** → The stub guard in Decision 10. The reviewer confirms that the five test files fail against the stubs.
- **No test profile exists for the ship run** → `.claude/testing/profile.json` is missing. It is created by running `/interlock:fix-tests` once, which is outside this change.

## Migration Plan

Nothing is deployed differently. The change adds files that nothing calls. Rolling back means reverting the commit.

## Open Questions

These can be answered later without changing the specs, the approach or the tasks.

- Should a rejection also carry the date or the amount it refers to, so that EB-05 can name it in the reply?
- Should a currency word after the number, such as `250 pesos`, count as a mark?
- Should `at`, the Filipino word for "and", be a separator? It collides with the English word.
