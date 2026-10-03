## MODIFIED Requirements

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
