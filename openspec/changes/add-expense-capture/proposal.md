## Why

The bot can read an expense message (EB-02), but it cannot store one, file it under a category, or answer it. This change builds the core loop of the epic in one step: a member types `lunch 250` in the group, the bot stores an entry and replies with one confirmation (docs/epic.md:377). It combines EB-03 (expense ledger), EB-04 (categories and keyword matching) and EB-05 (capture flow) at the user's request (D1), because capture is the first caller of the other two, and its retry rule decides how the ledger avoids duplicates. After this change the household can start logging every day (docs/epic.md:212).

## What Changes

- **Expense ledger (EB-03).** A new `expenses` table (migration `0002`) and store functions in `src/ledger/`:
  - add all items of one message at once, only once, and all or nothing;
  - attach the confirmation message id;
  - find the entries of a source message;
  - soft delete, restore and set category, each with who did it;
  - find a member's latest active entry;
  - list entries by period, total them by category, and count the active entries for a date.

  Amounts are whole centavos from 1 to 999,999,999. Nothing is hard-deleted. The raw message text is kept. The ledger stores the category id as a plain id that the caller has validated.
- **Categories and keyword matching (EB-04).** In `src/categories/`:
  - the 14 default categories and about 10 seed keywords per category, both kept in configuration files;
  - a `keyword_map` table for learned keywords (migration `0003`), which starts empty;
  - a matcher that works on normalized, whole words. Learned keywords come first, then seed keywords, then `other`. The longest phrase wins, and a tie goes to the keyword that appears first.
- **Capture flow (EB-05).** A `capture` module registered in `src/modules.ts`:
  - It handles text messages from members that are not commands. Each goes through the parser, then the matcher, then the ledger, and the bot sends one reply to the message.
  - The sender is the payer, and the reply's message id is saved on the entries.
  - Casual chat gets no reply. A rejected message gets one short reply with the reason, and nothing is stored.
  - A flagged item is stored with the parser's best guess and marked `⚠️ check amount`.
  - Photos, voice notes, stickers and edited messages are ignored.
  - When the reply fails to send, the entries stay stored, and the retry sends one confirmation without creating duplicates.
- **Clarifications of the epic.** Each one is a recorded decision in `decisions.md` and is explained in `design.md`. The main ones:
  - The ledger gains a `check_amount` column, so a confirmation built on a retry, or edited later, keeps the ⚠️ marker (D22).
  - Queries by period, the latest entry and the count for a date cover the whole ledger, not only the current chat id, so entries stored before a supergroup migration still count (D16).
  - Categories gain a short name for replies, such as `Dining` for `Dining & Delivery` (D26).
  - Capture reads the message at the time it was sent, not the time of the attempt (D34).
  - Replies are plain text, so a description with `<` or `&` shows as typed without escaping (D38).
  - When the reply is sent but its id cannot be saved, the failure is logged and not retried, so the group does not get a second confirmation (D37).
  - A confirmation is still sent when the member deleted the message first, and long descriptions are shortened in it, so a reply never fails on every attempt (D52, D53).
  - When it cannot be known whether a reply reached Telegram, the retry confirms again. A missing ✅ would make a member retype the expense. This is a narrow exception to the epic's rule of at most one bot message per message (D51).

### Non-goals

- Buttons, `/undo`, and applying edits (EB-06).
- Writing learned keywords, and incrementing their hit counts (EB-07).
- Reports and digests (EB-08, EB-10), the nudge (EB-11), and export (EB-12).
- LLM parsing or categorizing (EB-13).
- Hard deletes, and changing an amount, date or description in place.
- Detecting duplicates between members.
- Commands to list or edit categories and keywords.

## Capabilities

### New Capabilities

- `expense-ledger`: the durable household ledger of expense entries. It covers the atomic, once-only write of one message's items, soft delete and restore, category changes with who made them, and the queries later issues read: by source message, latest active entry, list, totals and count.
- `categorization`: the category list, the seed keywords, the `keyword_map` table of learned keywords, text normalization, and the whole-word matcher that gives an entry its category and category source.
- `expense-capture`: turning a member's text message into ledger entries with one confirmation reply, or into one rejection reply, or into silence, so that repeating the same update is safe.

### Modified Capabilities

None. Capture uses the registration contract of `bot-gateway` and the parser of `expense-parsing` as they are specified.

## Impact

- **Code.** New directories `src/ledger/`, `src/categories/` and `src/capture/`. An import and one list entry are added to `src/modules.ts`. No gateway or parser file changes.
- **Database.** Two new migrations: `migrations/0002_expense_ledger.sql` (`expenses`) and `migrations/0003_categorization.sql` (`keyword_map`). Apply them with `npm run db:migrate:remote` before the deploy that registers capture.
- **Tests.** New test files for the ledger, the categories, the formatter and the capture flow. Three test helpers are extended: `test/helpers/db.ts` gains the two new tables and a failure inside a batch, `test/helpers/telegram.ts` gains a failed call, and `test/helpers/updates.ts` gains sticker and voice builders.
- **Dependencies and configuration.** None added. The category list and the keywords ship in the code.
- **Behavior of the deployed bot.** Plain text from members is now read. An expense is stored and confirmed, and a rejection is answered. Privacy mode must be off, which the setup guide already requires. Until EB-06 adds Undo, a wrong entry can only be removed in the D1 console (D54).
- **D1 budget.** A message uses at most 14 D1 statements in capture, plus at most 6 in the gateway, of the 50 allowed per invocation.
- **Later issues.** EB-06, EB-08, EB-11 and EB-12 call the ledger. EB-07 and EB-13 write to `keyword_map` through the same normalizer.
