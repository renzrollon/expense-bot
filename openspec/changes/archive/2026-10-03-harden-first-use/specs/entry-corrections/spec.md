## ADDED Requirements

### Requirement: The system SHALL act on a press only from the entry's confirmation

A press of `c`, `s`, `u`, `r` or `b` SHALL change the ledger, teach a keyword or edit a message only when the pressed message is the confirmation of the entry that the data names. The pressed message is that confirmation when it is in the entry's chat and its message id is the confirmation message id stored with the entry. When the entry has no stored confirmation message id, the pressed message is that confirmation only when it is a reply to the entry's source message.

Any other press SHALL change nothing, SHALL teach nothing, SHALL edit no message, and SHALL be answered with the notice `This button no longer works.` The check SHALL use only the chat and the message id of the pressed message, and the message it replies to, because Telegram gives nothing more for an old message.

Rationale: an entry id is used again after rows are lost, for example after the database is emptied or restored. The id in a button does not name the entry by itself, and an old button must not remove or refile a newer entry that took its id.

#### Scenario: Happy path — a button on the entry's own confirmation
- **GIVEN** entry 7, whose confirmation is message 900
- **WHEN** a member presses `u:7` on message 900
- **THEN** entry 7 is removed, and the press is answered with the notice `Removed.`

#### Scenario: Failure — an old button whose entry id was taken by a newer entry
- **GIVEN** the ledger was emptied, and a new entry took id 1, with the confirmation message 950
- **WHEN** a member presses `u:1`, `c:1`, `s:1:dining`, `r:1` or `b:1` on the older message 400
- **THEN** the entry is unchanged, no keyword is learned, no message is edited, and each press is answered with the notice `This button no longer works.`

#### Scenario: Failure — a button on the confirmation of another message
- **GIVEN** entry 7, whose confirmation is message 900, and entry 12, whose confirmation is message 905
- **WHEN** a member presses `u:7` on message 901, or `s:12:dining` on message 900
- **THEN** no entry changes, and each press is answered with the notice `This button no longer works.`

#### Scenario: Edge case — the confirmation id was never saved
- **GIVEN** entry 7 of source message 41 has no stored confirmation message id
- **WHEN** a member presses `u:7` on a message that replies to message 41
- **THEN** entry 7 is removed
- **AND** a press of `u:7` on a message that replies to another message, or to none, is answered with the notice `This button no longer works.` and changes nothing
