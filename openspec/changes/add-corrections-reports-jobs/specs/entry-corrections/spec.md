## Purpose

Entry corrections let either member fix a logged expense with one tap, without adding clutter to the chat. A member can remove an entry, restore it, or change its category from the buttons under its confirmation, or remove their latest entry with `/undo`. A manual category pick also teaches the bot the keyword, so the same correction is not needed twice.

## ADDED Requirements

In every scenario of this specification, unless the scenario says otherwise:

- the household timezone is `Asia/Manila`, and the members are Ana (user id 1001) and Ben (user id 1002);
- Ana's message 41, `lunch 250`, was logged at 10:00 on Tuesday 2026-09-29 as entry 7, in `dining` from source `keyword`, and confirmed by the bot's message 900;
- Ana's message 42, `grab 180, groceries 2340 gcash`, was logged a minute later as entries 8 and 9, and confirmed by the bot's message 901;
- Ana's message 45, `acai 150`, was logged a minute after that as entry 12, in `other` from source `default`, and confirmed by the bot's message 905.

A **press** is a tap on a button under a confirmation. A press is **answered with a notice** when Telegram shows a short text to the member who pressed, and no chat message is posted. A confirmation is **set to its current state** when its text and buttons are set again as the `expense-capture` requirement "The confirmation shows the current state of its entries" defines them. That is always an edit of the existing message, never a new one.

### Requirement: The system SHALL make corrections available in the deployed bot

The deployed bot SHALL register corrections as a feature module, before capture. Corrections SHALL register the button prefixes `c`, `s`, `u`, `r` and `b`, the command `undo` with the description `remove your last entry`, and one handler for edited messages. It SHALL register no handler for new messages and no job, so that capture stays the last and only handler that logs a message.

Rationale: the buttons that capture puts under a confirmation carry these prefixes, so a press reaches corrections through the gateway's routing.

#### Scenario: Happy path — the command is listed
- **GIVEN** the bot as it is deployed
- **WHEN** a member sends `/help`
- **THEN** the reply holds the line `/undo · remove your last entry`

#### Scenario: Failure — a prefix that corrections does not own
- **GIVEN** the bot as it is deployed
- **WHEN** a member presses a button with the data `x:7`
- **THEN** the press is answered with the notice `This button no longer works.`, and no entry changes

#### Scenario: Edge case — a new message is not handled by corrections
- **GIVEN** the bot as it is deployed
- **WHEN** Ana sends `coffee 80`
- **THEN** one entry is stored and one confirmation is sent, by capture alone
- **AND** corrections registers no handler for new messages

### Requirement: The system SHALL remove an entry when Undo is pressed

A press with the data `u:<entry id>` SHALL remove the entry, as a soft delete recorded with the member who pressed. The confirmation SHALL be set to its current state, and the press SHALL be answered with the notice `Removed.` Either member SHALL be able to remove any entry. When the entry is already removed, nothing in the ledger SHALL change, the confirmation SHALL be set to its current state, and the press SHALL be answered with the notice `Already removed.`

Rationale: an entry that is hard to remove destroys trust in the totals, and a removal has to leave no clutter in the chat.

#### Scenario: Happy path — Undo removes the entry
- **WHEN** Ana presses `Undo` under message 900
- **THEN** entry 7 is removed, with the remover 1001, and it counts in no total
- **AND** message 900 is edited to `🗑 removed · ₱250 · 🍽 Dining · Ana · today` with the one button `Restore`
- **AND** the press is answered with the notice `Removed.`, and the bot posts no new message

#### Scenario: Failure — the entry is already removed
- **GIVEN** Ana removed entry 7
- **WHEN** Ben presses a button with the data `u:7`
- **THEN** entry 7 keeps its first removal time and the remover 1001
- **AND** the press is answered with the notice `Already removed.`, and the bot posts no new message

#### Scenario: Edge case — the other member removes the entry
- **WHEN** Ben presses `Undo` under message 900
- **THEN** entry 7 is removed with the remover 1002, and its payer is still 1001

#### Scenario: Edge case — one entry of several
- **WHEN** Ana presses `1 · Undo` under message 901
- **THEN** entry 8 is removed and entry 9 stays active
- **AND** message 901 is edited to:

```
✅ 1 of 2 entries · ₱2,340 · Ana · today
1. 🗑 removed · ₱180 · 🚗 Transport · grab
2. ₱2,340 · 🛒 Groceries · groceries gcash
```

### Requirement: The system SHALL restore an entry when Restore is pressed

A press with the data `r:<entry id>` SHALL restore the removed entry, recorded with the member who pressed, with every other field as it was before the removal. The confirmation SHALL be set to its current state, and the press SHALL be answered with the notice `Restored.` When the entry is already active, nothing in the ledger SHALL change, the confirmation SHALL be set to its current state, and the press SHALL be answered with the notice `Already active.`

Rationale: Undo is one tap, so undoing an Undo has to be one tap too.

#### Scenario: Happy path — Restore brings the entry back
- **GIVEN** Ana removed entry 7
- **WHEN** Ana presses `Restore` under message 900
- **THEN** entry 7 is active again, with the amount 25000 and the category `dining`, and it counts in totals again
- **AND** message 900 is edited to `✅ ₱250 · 🍽 Dining · Ana · today` with the buttons `Category` and `Undo`
- **AND** the press is answered with the notice `Restored.`

#### Scenario: Failure — the entry is already active
- **GIVEN** entry 7 is active
- **WHEN** Ben presses a button with the data `r:7`
- **THEN** entry 7 is unchanged, and its last change is still Ana's
- **AND** the press is answered with the notice `Already active.`

#### Scenario: Edge case — a restored entry keeps a category picked before it was removed
- **GIVEN** entry 12 was set to `dining` by hand and then removed
- **WHEN** Ben presses `Restore` under message 905
- **THEN** entry 12 is active with the category `dining` from source `manual`
- **AND** message 905 is edited to `✅ ₱150 · 🍽 Dining · Ana · today`

### Requirement: The system SHALL let a member pick a category from a grid

A press with the data `c:<entry id>` on an active entry SHALL replace the confirmation's buttons with the category grid and SHALL leave its text unchanged. The grid SHALL hold one button for each category of the category list, in display order, 3 to a row, labeled with the category's emoji, a space and its short name, with the data `s:<entry id>:<category id>`. Below the categories it SHALL hold one row with the button `Back`, with the data `b:<entry id>`. This press SHALL be answered without a notice text.

A press with the data `b:<entry id>` SHALL set the confirmation to its current state and SHALL change nothing in the ledger.

A press with the data `s:<entry id>:<category id>` on an active entry SHALL set the entry's category to that category with the source `manual`, recorded with the member who pressed. The confirmation SHALL be set to its current state, which shows the new category and the default buttons. The notice is defined by the requirement "The system SHALL learn a keyword from a manual pick".

When the entry is removed, a press with the data `c:…` or `s:…` SHALL change nothing in the ledger. The confirmation SHALL be set to its current state, and the press SHALL be answered with the notice `This entry was removed.` A press with the data `s:…` whose category id is not in the category list SHALL change nothing, and SHALL be answered with the notice `This button no longer works.`

Rationale: the bot never waits for a typed answer, so the category is picked from buttons, and the pick changes the same message.

#### Scenario: Happy path — the grid opens
- **WHEN** Ana presses `Category` under message 905
- **THEN** the text of message 905 is unchanged, and its buttons become six rows
- **AND** the first row is `🛒 Groceries` (`s:12:groceries`), `🍽 Dining` (`s:12:dining`) and `🚗 Transport` (`s:12:transport`)
- **AND** the fifth row is `❓ Other` (`s:12:other`) and `🔁 Transfers` (`s:12:transfer`), and the sixth row is `Back` (`b:12`)

#### Scenario: Happy path — a category is picked
- **GIVEN** message 905 shows the grid
- **WHEN** Ana presses `🍽 Dining`
- **THEN** entry 12 has the category `dining` from source `manual`, last changed by 1001
- **AND** message 905 is edited to `✅ ₱150 · 🍽 Dining · Ana · today` with the buttons `Category` and `Undo`, and the bot posts no new message

#### Scenario: Failure — the entry was removed meanwhile
- **GIVEN** Ana removed entry 12 while Ben's phone still showed the grid under message 905
- **WHEN** Ben presses `🍽 Dining`, which carries the data `s:12:dining`
- **THEN** entry 12 stays removed in `other`, and nothing is learned
- **AND** message 905 is edited to `🗑 removed · ₱150 · ❓ Other · Ana · today` with the one button `Restore`
- **AND** the press is answered with the notice `This entry was removed.`

#### Scenario: Failure — a category that is not in the list
- **WHEN** Ana presses a button with the data `s:12:snacks`
- **THEN** entry 12 is unchanged, and the press is answered with the notice `This button no longer works.`

#### Scenario: Edge case — Back
- **GIVEN** message 905 shows the grid
- **WHEN** Ana presses `Back`
- **THEN** message 905 has the buttons `Category` and `Undo` again, and entry 12 is unchanged

#### Scenario: Edge case — the grid of one entry of several
- **WHEN** Ana presses `2 · Category` under message 901 and then `🧹 Household`
- **THEN** entry 9 has the category `household` from source `manual`, and entry 8 is unchanged
- **AND** the second line of message 901 reads `2. ₱2,340 · 🧹 Household · groceries gcash`

### Requirement: The system SHALL learn a keyword from a manual pick

After a press with the data `s:<entry id>:<category id>`, when the entry is active and holds the picked category, the bot SHALL teach the entry's description as a keyword for that category, taught by the member who pressed, provided that the description is learnable as `categorization` defines. The press SHALL then be answered with the notice `<keyword>: <short name> from now on`, where the keyword is the taught keyword and the short name is the category's. A keyword longer than 60 characters SHALL be shown as its first 59 characters followed by `…`.

When the description is not learnable, nothing SHALL be taught, the entry SHALL still be changed, and the press SHALL be answered with the notice `Filed under <emoji> <short name>.`

A learned keyword SHALL be in effect for every later message, from either member, and SHALL stay in effect when the bot is deployed again.

Rationale: a category should need correcting only once.

#### Scenario: Happy path — a correction is learned
- **WHEN** Ana presses `Category` under message 905 and then `🍽 Dining`
- **THEN** the press is answered with the notice `acai: Dining from now on`
- **AND** the learned keywords hold `acai` for `dining` from source `learned`, taught by 1001
- **AND** when Ben then sends `acai 150`, his entry is filed under `dining` with the source `learned`

#### Scenario: Failure — a description that is not learnable
- **GIVEN** Ana's message `lunch with ana at jollibee 900` was logged as entry 13 in `dining`
- **WHEN** Ana picks `🎁 Gifts` for entry 13
- **THEN** entry 13 has the category `gifts` from source `manual`, and the learned keywords are unchanged
- **AND** the press is answered with the notice `Filed under 🎁 Gifts.`

#### Scenario: Edge case — the same keyword is corrected again
- **GIVEN** `acai` was learned for `dining`
- **WHEN** Ben picks `🛒 Groceries` for entry 12
- **THEN** the learned keywords hold one row for `acai`, for `groceries`, taught by 1002
- **AND** a later `acai 150` is filed under `groceries`

#### Scenario: Edge case — an empty description
- **GIVEN** Ana's message `250` was logged as entry 14 with an empty description
- **WHEN** Ana picks `🍽 Dining` for entry 14
- **THEN** entry 14 has the category `dining`, nothing is learned, and the notice is `Filed under 🍽 Dining.`

#### Scenario: Edge case — the bot is deployed again
- **GIVEN** `acai` was learned for `dining`
- **WHEN** the bot is deployed again and Ana sends `acai 150`
- **THEN** the entry is filed under `dining` with the source `learned`

#### Scenario: Edge case — casing and spacing of the description
- **GIVEN** Ana's message `Açaí  Bowl 180` was logged as entry 15 in `other`
- **WHEN** Ana picks `🍽 Dining` for entry 15
- **THEN** the keyword `acai bowl` is learned, and the notice is `acai bowl: Dining from now on`
- **AND** a later `ACAI BOWL 180` is filed under `dining` with the source `learned`

### Requirement: The system SHALL remove the sender's latest entry on /undo

The command `/undo` SHALL remove the sender's latest active entry, as the ledger defines it, recorded with the sender. When that entry has a confirmation message id, its confirmation SHALL be set to its current state. The bot SHALL answer with exactly one message, sent as a reply to the command: `↩️ Removed <amount> · <category> · <description>`, with the description, and its ` · `, left out when it is empty, and shortened as in a confirmation when it is longer than 60 characters. Text after the command SHALL be ignored.

When the sender has no active entry, nothing SHALL change, and the bot SHALL reply `Nothing to undo.`

The removal SHALL be recorded with the time the command was sent, not the time of the attempt. When the command is processed again after a failed attempt, the bot SHALL find the entry that this command already removed, SHALL remove no other entry, and SHALL send the reply.

Rationale: "the latest entry" is a different entry after each removal, so a repeated attempt must not move on to the next one.

#### Scenario: Happy path — /undo removes the latest entry
- **WHEN** Ana sends `/undo`
- **THEN** entry 12 is removed with the remover 1001, and entries 7, 8 and 9 stay active
- **AND** message 905 is edited to `🗑 removed · ₱150 · ❓ Other · Ana · today` with the one button `Restore`
- **AND** the bot replies once to the command: `↩️ Removed ₱150 · ❓ Other · acai`

#### Scenario: Failure — nothing to undo
- **GIVEN** Ben has no active entry
- **WHEN** Ben sends `/undo`
- **THEN** no entry changes, and the bot replies once: `Nothing to undo.`

#### Scenario: Edge case — the command is processed twice
- **GIVEN** Ana sends `/undo`, entry 12 is removed, and sending the reply fails
- **WHEN** Telegram delivers the command again
- **THEN** entry 9, which is now Ana's latest active entry, stays active
- **AND** entry 12 keeps its first removal time, and the bot replies `↩️ Removed ₱150 · ❓ Other · acai`

#### Scenario: Edge case — only the sender's entries
- **GIVEN** Ben logged `taxi 200` after every entry of Ana's
- **WHEN** Ana sends `/undo`
- **THEN** entry 12 is removed, and Ben's entry stays active

#### Scenario: Edge case — the latest entry is one of several
- **GIVEN** entry 12 was already removed
- **WHEN** Ana sends `/undo`
- **THEN** entry 9 is removed and entry 8 stays active
- **AND** the header of message 901 becomes `✅ 1 of 2 entries · ₱180 · Ana · today`
- **AND** the bot replies `↩️ Removed ₱2,340 · 🛒 Groceries · groceries gcash`

#### Scenario: Edge case — the confirmation id is not known
- **GIVEN** entry 12 has no confirmation message id
- **WHEN** Ana sends `/undo`
- **THEN** entry 12 is removed, no message is edited, and the bot replies `↩️ Removed ₱150 · ❓ Other · acai`

### Requirement: The system SHALL mark the confirmation when a logged message is edited

When a member edits a message that has entries, and the edited text differs from the stored raw text, the bot SHALL NOT change any amount, date, description or category. It SHALL record the edit mark on the message's entries. When the entries have a confirmation message id, the confirmation SHALL be set to its current state, which ends with the line `✏️ Edit not applied. Undo and resend.` while an entry is active. The bot SHALL post no new message.

An edited message that has no entries SHALL change nothing and get no reply, whatever its new text is. An edit whose text equals the stored raw text SHALL change nothing.

Rationale: without the notice, an edit looks applied when it is not.

#### Scenario: Happy path — a logged message is edited
- **WHEN** Ana edits message 41 from `lunch 250` to `lunch 300`
- **THEN** entry 7 still has the amount 25000 and the raw text `lunch 250`
- **AND** message 900 is edited to:

```
✅ ₱250 · 🍽 Dining · Ana · today
✏️ Edit not applied. Undo and resend.
```

- **AND** its buttons are still `Category` and `Undo`, and the bot posts no new message

#### Scenario: Failure — a message that was never logged
- **GIVEN** Ana's message 50, `ok thanks`, was not an expense
- **WHEN** Ana edits message 50 to `lunch 250`
- **THEN** no entry is stored, no message is edited, and the bot sends nothing

#### Scenario: Edge case — a second edit
- **GIVEN** Ana edited message 41 to `lunch 300`
- **WHEN** Ana edits message 41 again, to `lunch 350`
- **THEN** message 900 still holds the notice line once, and entry 7 keeps its first edit time

#### Scenario: Edge case — the notice stays after a later correction
- **GIVEN** Ana edited message 41 to `lunch 300`
- **WHEN** Ben picks `🎁 Gifts` for entry 7
- **THEN** message 900 is edited to `✅ ₱250 · 🎁 Gifts · Ana · today`, followed by the line `✏️ Edit not applied. Undo and resend.`

#### Scenario: Edge case — the entries are all removed
- **GIVEN** Ana edited message 41 to `lunch 300`
- **WHEN** Ana presses `Undo` under message 900
- **THEN** message 900 is edited to `🗑 removed · ₱250 · 🍽 Dining · Ana · today`, with no notice line

#### Scenario: Edge case — the text did not change
- **WHEN** Telegram reports an edit of message 41 whose text is still `lunch 250`
- **THEN** no entry gets an edit mark, and no message is edited

### Requirement: The system SHALL ignore button data it cannot use

A press whose data does not have the form its prefix requires, or names an entry the ledger does not hold, SHALL change nothing, SHALL edit no message, and SHALL be answered with the notice `This button no longer works.` An entry id SHALL be written as a positive whole number without a sign, a leading zero or white space. The data of `c`, `u`, `r` and `b` SHALL hold an entry id and nothing else. The data of `s` SHALL hold an entry id, a colon and a category id.

Rationale: button data comes back from Telegram and can be stale or forged, and every press must be answered, or the button keeps showing a loading state.

#### Scenario: Happy path — an entry the ledger does not hold
- **GIVEN** the ledger holds no entry 424242
- **WHEN** a member presses a button with the data `u:424242`
- **THEN** no entry changes, no message is edited, and the press is answered with the notice `This button no longer works.`

#### Scenario: Failure — malformed data
- **WHEN** a member presses a button with the data `u:`, `u:abc`, `u:7:extra`, `s:7`, `s:7:` or `c:-7`
- **THEN** no entry changes, no message is edited, and the press is answered with the notice `This button no longer works.`

#### Scenario: Edge case — an id that looks like 7 but is not written as one
- **WHEN** a member presses a button with the data `u:07`, `u: 7`, `u:7.0` or `u:+7`
- **THEN** entry 7 is unchanged, and the press is answered with the notice `This button no longer works.`

### Requirement: The system SHALL keep corrections safe to repeat

The gateway runs a handler again when an earlier attempt failed. Corrections SHALL act so that a repeated update never applies a correction a second time, and so that a confirmation that can no longer be edited never blocks a correction.

- A change to the ledger SHALL be made before any message is edited, and SHALL stand whatever happens to the message afterwards.
- When Telegram refuses the edit of a confirmation as a bad request, the attempt SHALL NOT fail. That covers a message whose text and buttons are already as asked, a message that was deleted, and a message that can no longer be edited. Unless the refusal says the message is not modified, the bot SHALL write one log entry with the event `edit_skipped` and the update id.
- When the edit fails in any other way, such as a rate limit, a server error or a network error, the attempt SHALL fail, so that the gateway runs the update again. The repeated attempt SHALL leave the ledger as the first attempt left it, and SHALL edit the confirmation.
- Answering a press SHALL be done last and SHALL NOT fail the attempt. When the answer fails, the bot SHALL write one log entry with the event `callback_answer_failed` and the update id.

No log entry SHALL hold message text, a description or a name.

#### Scenario: Happy path — a failed edit is repeated
- **GIVEN** Ana presses `Undo` under message 900, entry 7 is removed, and the edit of message 900 fails with a server error
- **WHEN** Telegram delivers the press again
- **THEN** entry 7 is still removed once, with its first removal time
- **AND** message 900 is edited to `🗑 removed · ₱250 · 🍽 Dining · Ana · today`

#### Scenario: Failure — the confirmation was deleted
- **GIVEN** entries 8, 9 and 12 were removed, so entry 7 is Ana's latest active entry, and message 900 was deleted from the chat, so Telegram answers an edit of it with a bad-request error
- **WHEN** Ana sends `/undo`
- **THEN** entry 7 is removed, the update is handled successfully, and the bot replies `↩️ Removed ₱250 · 🍽 Dining · lunch`
- **AND** one log entry holds the event `edit_skipped` and the update id, and no text

#### Scenario: Edge case — the message is already as asked
- **GIVEN** message 900 already shows entry 7 as removed
- **WHEN** Ben presses a button with the data `u:7`, and Telegram refuses the edit because the message is not modified
- **THEN** the update is handled successfully, the press is answered with the notice `Already removed.`, and no log entry `edit_skipped` is written

#### Scenario: Edge case — the press cannot be answered
- **GIVEN** Ana presses `Undo` under message 900, and answering the press fails
- **WHEN** the attempt ends
- **THEN** entry 7 is removed, message 900 is edited, and the update is handled successfully
- **AND** one log entry holds the event `callback_answer_failed` and the update id
