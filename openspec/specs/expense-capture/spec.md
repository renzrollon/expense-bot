## Purpose

Capture is the core loop of the bot. A member's text message in the group becomes ledger entries, and the bot answers with one confirmation. A message that cannot be logged gets one reply with the reason, and ordinary chat gets no reply at all.

## Requirements

### Requirement: Which messages are captured
Capture SHALL handle every new text message that reaches message handlers: a message from a member in the allowed group that does not start with a command. That includes a reply to another message, and a reply to the bot. Capture SHALL ignore a message that has no text, such as a photo (even with a caption), a sticker, a voice note or a service message. It SHALL ignore a forwarded message and a message sent through another bot, because the member did not type them as an expense. It SHALL also ignore an edited message. An ignored message SHALL store nothing and get no reply from capture. The notice that the confirmation of an edited message gains is defined by `entry-corrections`, not by capture.

In every scenario of this specification, unless the scenario says otherwise, the household timezone is `Asia/Manila`, the member Ana sends the message at `2026-09-29T02:00:00Z` (10:00 on Tuesday 2026-09-29 in Manila), the bot handles it a few seconds later, and Ana's first name is `Ana`.

#### Scenario: A photo with a caption is ignored
- **WHEN** Ana sends a photo with the caption `lunch 250`
- **THEN** no entry is stored and the bot sends nothing

#### Scenario: A sticker or a voice note is ignored
- **WHEN** Ana sends a sticker, or a voice note
- **THEN** no entry is stored and the bot sends nothing

#### Scenario: An edit is ignored
- **WHEN** Ana sends `lunch 250`, which is logged and confirmed, and then edits the message to `lunch 300`
- **THEN** the ledger still holds one entry of ₱250
- **AND** capture stores nothing and posts no new message for the edit

#### Scenario: A forwarded message is ignored
- **WHEN** Ana forwards a message whose text is `lunch 250` to the group
- **THEN** no entry is stored and the bot sends nothing

#### Scenario: A message sent through another bot is ignored
- **WHEN** Ana sends `lunch 250` through an inline bot
- **THEN** no entry is stored and the bot sends nothing

#### Scenario: A reply to another message is captured
- **WHEN** Ana replies to an earlier message in the group with `lunch 250`
- **THEN** one entry of ₱250 is stored and confirmed

### Requirement: The message is read at the time it was sent
Capture SHALL read the text with the expense parser, passing the time the message was sent and the household timezone. It SHALL NOT pass the time of the attempt, so that the dates in a message do not depend on when an attempt runs. The date word in the confirmation is relative to the date the entry was stored, as the requirement "The confirmation shows the current state of its entries" defines.

#### Scenario: Happy path — handled seconds after it was sent
- **GIVEN** Ana sends `lunch 250` at 10:00:00 on 2026-09-29 in Manila
- **WHEN** the first attempt to handle it runs at 10:00:03
- **THEN** the entry's spent-on date is `2026-09-29`, and the confirmation says `today`

#### Scenario: A late attempt keeps the send date
- **WHEN** Ana sends `lunch 250` at 23:59:00 on 2026-09-29 in Manila, and the first attempt to handle it runs at 00:00:05 on 2026-09-30
- **THEN** the entry's spent-on date is `2026-09-29`
- **AND** the confirmation says `yesterday`, because the entry was stored on 2026-09-30

#### Scenario: Failure — a date that was in the future when the message was sent
- **GIVEN** Ana sends `sep 30 lunch 250` at 23:59:00 on 2026-09-29 in Manila
- **WHEN** the first attempt to handle it runs at 00:00:05 on 2026-09-30
- **THEN** no entry is stored, and the bot replies `❌ Not logged: the date is in the future.`

### Requirement: Ordinary chat gets no reply
When the parser reads a message as not an expense, capture SHALL store nothing and SHALL send nothing.

#### Scenario: Casual chat
- **WHEN** Ana sends `ok thanks`, `see you at 5pm`, `magkano na gastos natin?` or `lunch 250?`
- **THEN** no entry is stored and the bot sends nothing

### Requirement: A rejected message gets one reply with the reason
When the parser rejects a message, capture SHALL store nothing and SHALL send exactly one reply to the message with the reason:

| Reason | Reply |
|---|---|
| `multiple_dates` | `❌ Not logged: use one date per message.` |
| `invalid_date` | `❌ Not logged: that date does not exist.` |
| `future_date` | `❌ Not logged: the date is in the future.` |
| `amount_out_of_range` | `❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.` |
| `too_many_items` | `❌ Not logged: 10 items per message at most. Send the rest in another message.` |

#### Scenario: A future date
- **WHEN** Ana sends `oct 15 rent 12000`
- **THEN** no entry is stored
- **AND** the bot sends one reply to that message: `❌ Not logged: the date is in the future.`

#### Scenario: An amount out of range
- **WHEN** Ana sends `condo 25,000,000`
- **THEN** no entry is stored, and the bot replies `❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.`

#### Scenario: A zero amount
- **WHEN** Ana sends `lunch 0`
- **THEN** no entry is stored, and the bot replies `❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.`

#### Scenario: Too many items
- **WHEN** Ana sends a message of 11 items, one on each line
- **THEN** no entry is stored, and the bot replies `❌ Not logged: 10 items per message at most. Send the rest in another message.`

### Requirement: Each item is stored as an entry
When the parser returns items, capture SHALL file each item under a category with the keyword matcher, using the learned keywords, and SHALL store all items of the message in the ledger in one write. Each entry SHALL hold:

- the chat id and the message id;
- the item's position in the message;
- the sender as payer and as creator;
- the item's amount, description and date;
- the matched category id and category source;
- the parser `rules`;
- the whole message text as the raw text;
- an amount check exactly when the parser flagged the item `ambiguous_amount`.

#### Scenario: One expense
- **WHEN** Ana sends `lunch 250`
- **THEN** one entry is stored with the payer Ana, the amount 25000, the description `lunch`, the category `dining` from source `keyword`, the spent-on date `2026-09-29`, the parser `rules`, the raw text `lunch 250`, and no amount check

#### Scenario: Two expenses in one message
- **WHEN** Ana sends `grab 180, groceries 2340 gcash`
- **THEN** two entries are stored: item 0 of ₱180 `grab` in `transport`, and item 1 of ₱2,340 `groceries gcash` in `groceries`

#### Scenario: A flagged amount
- **WHEN** Ana sends `dinner for 2 600`
- **THEN** one entry of ₱600 is stored with the description `dinner for 2`, the category `dining`, and an amount check

#### Scenario: A backdated expense
- **WHEN** Ana sends `kahapon lunch 250`
- **THEN** the entry's spent-on date is `2026-09-28`

#### Scenario: No keyword matches
- **WHEN** Ana sends `acai 150`
- **THEN** the entry is filed under `other` with the source `default`

#### Scenario: A bare number is an expense
- **WHEN** Ana sends `250`
- **THEN** one entry of ₱250 is stored with an empty description under `other`
- **AND** the reply is `✅ ₱250 · ❓ Other · Ana · today`

#### Scenario: A learned keyword is used
- **WHEN** the learned keywords hold `acai` for `dining` from source `learned`, and Ana sends `acai 150`
- **THEN** the entry is filed under `dining` with the source `learned`

### Requirement: One confirmation per message
After storing the entries, capture SHALL send exactly one reply to the message and SHALL save the reply's message id on every entry of the message. The reply SHALL be plain text, with no formatting markup and no link preview, so that text typed by members shows exactly as typed. When the member's message was deleted before the reply is sent, the reply SHALL still be sent to the group, without the reference to the deleted message. Rejection replies SHALL be sent the same way, and SHALL carry no buttons.

The reply SHALL carry the correction buttons that the requirement "The confirmation shows the current state of its entries" defines.

A message with one entry SHALL be confirmed on one line:

`✅ <amount> · <category> · <payer> · <date>`

A message with several entries SHALL be confirmed with a header line and one line per entry, numbered from 1:

```
✅ <count> entries · <total> · <payer> · <date>
<n>. <amount> · <category> · <description>
```

The parts SHALL be written as follows:

- **amount and total:** `₱`, then the pesos with a comma between each group of three digits, then `.` and two digits only when the centavos are not zero. For example `₱250`, `₱2,520`, `₱1,500.50` and `₱0.05`.
- **category:** the category's emoji, a space and its short name, such as `🍽 Dining`. A category id that is not in the list is shown as the id alone.
- **payer:** the sender's first name.
- **date:** `today` when the spent-on date is the local date on which the message's first entry was stored, and `yesterday` when it is the day before. Otherwise it is the short English month and the day, such as `Sep 27`, with `, ` and the year added when the year differs from the year of that local date, such as `Dec 30, 2026`. A message's date is the date of its first entry.
- **description:** left out, together with its ` · `, when it is empty. A description longer than 60 characters is shown as its first 59 characters followed by `…`, so a confirmation always fits in one Telegram message.
- **amount check:** ` · ⚠️ check amount` is added at the end of the line of every entry that needs its amount checked.

The confirmation SHALL be built from the entries as stored in the ledger.

#### Scenario: One expense is confirmed on one line
- **WHEN** Ana sends `lunch 250`
- **THEN** the bot sends one reply to that message: `✅ ₱250 · 🍽 Dining · Ana · today`
- **AND** the reply's message id is saved on the entry

#### Scenario: Several expenses are confirmed together
- **WHEN** Ana sends `grab 180, groceries 2340 gcash`
- **THEN** the bot sends one reply to that message:

```
✅ 2 entries · ₱2,520 · Ana · today
1. ₱180 · 🚗 Transport · grab
2. ₱2,340 · 🛒 Groceries · groceries gcash
```

- **AND** the reply's message id is saved on both entries

#### Scenario: Centavos are shown when they are not zero
- **WHEN** Ana sends `groceries 1,500.50`
- **THEN** the reply is `✅ ₱1,500.50 · 🛒 Groceries · Ana · today`

#### Scenario: Yesterday
- **WHEN** Ana sends `kahapon lunch 250`
- **THEN** the reply is `✅ ₱250 · 🍽 Dining · Ana · yesterday`

#### Scenario: An earlier date this year
- **WHEN** Ana sends `sep 27 meralco 3200`
- **THEN** the reply is `✅ ₱3,200 · 💡 Bills · Ana · Sep 27`

#### Scenario: A date in the previous year
- **WHEN** Ana sends `dec 30 gift 500` on 2027-01-02
- **THEN** the reply is `✅ ₱500 · 🎁 Gifts · Ana · Dec 30, 2026`

#### Scenario: A flagged amount is marked
- **WHEN** Ana sends `dinner for 2 600`
- **THEN** the reply is `✅ ₱600 · 🍽 Dining · Ana · today · ⚠️ check amount`

#### Scenario: Text is shown as typed
- **WHEN** Ana sends `a<b 100, c&d 200`
- **THEN** the reply's lines show the descriptions `a<b` and `c&d` exactly as typed
- **AND** the reply is sent with no formatting mode and with link previews turned off

#### Scenario: A long description is shortened
- **WHEN** Ana sends a message of two items whose first description is 70 characters long
- **THEN** the first entry's line shows the first 59 characters of the description followed by `…`
- **AND** the ledger stores the whole description

#### Scenario: The member's message was deleted
- **WHEN** Ana sends `lunch 250` and deletes it before the confirmation is sent
- **THEN** the confirmation is still sent once to the group

#### Scenario: An empty description
- **WHEN** Ana sends `250, coffee 80`
- **THEN** the reply is:

```
✅ 2 entries · ₱330 · Ana · today
1. ₱250 · ❓ Other
2. ₱80 · 🍽 Dining · coffee
```

#### Scenario: A rejection carries no buttons
- **WHEN** Ana sends `oct 15 rent 12000`
- **THEN** the reply `❌ Not logged: the date is in the future.` is sent with no buttons

### Requirement: Repeating an update is safe
The gateway runs a message handler again when an earlier attempt failed. Capture SHALL act so that repeating the same update never stores a second set of entries, and sends a second confirmation only when it cannot know whether an earlier send reached Telegram.

- When the message's entries are already stored, capture SHALL use the stored entries.
- When any stored entry of the message already has a confirmation message id, capture SHALL send nothing.
- When the reply fails to send, the attempt SHALL fail and the entries SHALL stay stored. The next attempt SHALL send the confirmation.
- When the reply was sent but its message id could not be saved, capture SHALL NOT fail the attempt. It SHALL write one log line with the event `capture_confirmation_unsaved`, the update id as `update_id`, the id of the member's message as `message_id`, and the id of the reply as `confirmation_message_id`. It SHALL send no second reply.
- When a send's outcome is unknown, because the request failed with a network error or a timeout, or because the Worker stopped between the send and saving the reply's id, the next attempt SHALL send the confirmation again. A member who sees no confirmation retypes the expense, so a missing confirmation costs more than a repeated one.

No log line SHALL hold message text, a description or a name.

#### Scenario: The confirmation fails to send
- **WHEN** Ana sends `lunch 250`, and sending the reply fails
- **THEN** the attempt fails, the entry stays stored, and it has no confirmation message id
- **AND** when Telegram delivers the update again, the bot sends one confirmation, the ledger still holds one entry with its first creation time, and the reply's message id is saved on it

#### Scenario: The handler runs again after the confirmation was sent
- **WHEN** Ana's `lunch 250` was stored and confirmed, and the attempt then fails in another handler, so the update is run again
- **THEN** no second entry is stored and no second reply is sent

#### Scenario: The reply's message id cannot be saved
- **WHEN** Ana sends `lunch 250`, the reply is sent, and saving its message id fails
- **THEN** the update is handled successfully, the bot has sent exactly one reply, and the entry has no confirmation message id
- **AND** one log line holds exactly the event `capture_confirmation_unsaved`, the update id, the member's message id and the reply's id, and no message text

#### Scenario: A rejection is not stored
- **WHEN** Ana sends `oct 15 rent 12000`, and sending the reply fails
- **THEN** nothing is stored
- **AND** when Telegram delivers the update again, the bot sends the rejection reply once

### Requirement: Capture is registered
The deployed bot SHALL register capture in its list of feature modules, after the existing modules. Capture SHALL register one message handler and no command, no button prefix, no edited-message handler and no job. Capture's handler SHALL be the last message handler of the deployed bot, because a handler that fails after capture has replied would make a rejection reply repeat. A module added later SHALL be registered before capture.

#### Scenario: The deployed bot logs an expense
- **WHEN** a member sends `lunch 250` to the deployed Worker
- **THEN** one entry is stored and one confirmation is sent

#### Scenario: Capture adds no command
- **WHEN** a member sends `/help`
- **THEN** the reply lists no command registered by capture

#### Scenario: Capture is the last message handler
- **WHEN** the deployed bot's modules are registered
- **THEN** `core` is registered before `capture`, and the last message handler belongs to `capture`

### Requirement: The confirmation shows the current state of its entries

The text and the buttons of a confirmation SHALL depend only on the stored entries of its message, the payer's display name in the member records, and the household timezone. Capture SHALL send exactly this text and these buttons. Every later change to a confirmation SHALL set exactly this text and these buttons again, so a confirmation never shows anything other than the ledger as it is. The rules of this requirement are the only definition of a confirmation. `entry-corrections` uses them and adds none.

Rationale: one definition, used by every sender and editor of a confirmation, is what keeps a confirmation from drifting away from the ledger.

While every entry of the message is active and the message carries no edit mark, the text SHALL be exactly as the requirement "One confirmation per message" gives it. Otherwise these rules apply as well:

- **A removed entry of a one-entry message** SHALL be shown as `🗑 removed · <amount> · <category> · <payer> · <date>`.
- **A removed entry of a several-entry message** SHALL be shown as `<n>. 🗑 removed · <amount> · <category> · <description>`. Its number SHALL stay its position in the message, so the numbers of the other entries do not change.
- **A removed entry** SHALL NOT show the amount check.
- **The header of a several-entry message with a removed entry** SHALL be `✅ <active> of <count> entries · <total> · <payer> · <date>`, where the total covers the active entries only. When no entry is active, the header SHALL start with `🗑` instead of `✅`, and the total SHALL be `₱0`.
- **The edit notice.** While the message carries an edit mark and at least one of its entries is active, the text SHALL end with the line `✏️ Edit not applied. Undo and resend.`
- **The payer** SHALL be the display name that the member records hold for the payer of the message's first entry. When the member records hold no such member, the payer SHALL be shown as the user id.
- **The date word** SHALL be relative to the local date, in the household timezone, on which the message's first entry was stored.

The buttons SHALL be one row for each entry, in item order:

- an active entry has two buttons, `Category` with the data `c:<entry id>` and `Undo` with the data `u:<entry id>`;
- a removed entry has one button, `Restore` with the data `r:<entry id>`;
- when the message has several entries, each label SHALL start with the entry's number and ` · `, such as `2 · Undo`.

#### Scenario: Happy path — one active entry has two buttons
- **GIVEN** Ana's `lunch 250` is stored as entry 7
- **WHEN** capture sends its confirmation
- **THEN** the text is `✅ ₱250 · 🍽 Dining · Ana · today`
- **AND** the reply has one row of two buttons: `Category` with the data `c:7`, and `Undo` with the data `u:7`

#### Scenario: Happy path — several entries each have a numbered row
- **GIVEN** Ana's `grab 180, groceries 2340 gcash` is stored as entries 8 and 9
- **WHEN** capture sends its confirmation
- **THEN** the reply has two rows: `1 · Category` (`c:8`) and `1 · Undo` (`u:8`), then `2 · Category` (`c:9`) and `2 · Undo` (`u:9`)

#### Scenario: Failure — the payer has no member record
- **GIVEN** entry 7 has the payer 1001, and the member records hold no member 1001
- **WHEN** its confirmation is built
- **THEN** the text is `✅ ₱250 · 🍽 Dining · 1001 · today`, and the buttons are unchanged

#### Scenario: Edge case — one removed entry
- **GIVEN** entry 7, the only entry of its message, was removed
- **WHEN** its confirmation is built
- **THEN** the text is `🗑 removed · ₱250 · 🍽 Dining · Ana · today`
- **AND** the only button is `Restore` with the data `r:7`

#### Scenario: Edge case — one of several entries is removed
- **GIVEN** entries 8 and 9 of one message, and entry 8 was removed
- **WHEN** its confirmation is built
- **THEN** the text is:

```
✅ 1 of 2 entries · ₱2,340 · Ana · today
1. 🗑 removed · ₱180 · 🚗 Transport · grab
2. ₱2,340 · 🛒 Groceries · groceries gcash
```

- **AND** the rows are `1 · Restore` (`r:8`), then `2 · Category` (`c:9`) and `2 · Undo` (`u:9`)

#### Scenario: Edge case — every entry is removed
- **GIVEN** entries 8 and 9 of one message were both removed
- **WHEN** its confirmation is built
- **THEN** the header is `🗑 0 of 2 entries · ₱0 · Ana · today`, both lines read `🗑 removed`, and each row is one `Restore` button

#### Scenario: Edge case — a removed entry loses the amount check
- **GIVEN** the entry of `dinner for 2 600`, which needs its amount checked, was removed
- **WHEN** its confirmation is built
- **THEN** the text is `🗑 removed · ₱600 · 🍽 Dining · Ana · today`

#### Scenario: Edge case — the edit notice is shown only while an entry is active
- **GIVEN** the message of entries 8 and 9 carries an edit mark
- **WHEN** its confirmation is built while entry 9 is active
- **THEN** the last line is `✏️ Edit not applied. Undo and resend.`
- **AND** when both entries are removed, the text has no such line

#### Scenario: Edge case — the date word does not change with the day of the edit
- **GIVEN** entry 7 was stored on 2026-09-29 with the spent-on date `2026-09-29`
- **WHEN** its confirmation is built again on 2026-10-02
- **THEN** the text still ends with `today`
