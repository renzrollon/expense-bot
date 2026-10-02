## ADDED Requirements

### Requirement: The system SHALL let a job send each message once per scheduled date

The scheduler SHALL keep a send record for jobs. A record is identified by a job name, a scheduled date and a part name, where the part names one of the messages a job sends for one scheduled date. A job that sends through the send record SHALL get this behavior:

- When no record exists for the key, the send SHALL be performed. After it succeeds, a record SHALL be stored with the chat id and the message id of the sent message and the time.
- When a record exists for the key, the send SHALL NOT be performed, and the job SHALL be told that the message was already sent.
- When the send fails, the error SHALL pass on to the job, and no record SHALL be stored, so that a later run sends the message.
- When the send succeeds and the record cannot be stored, the job SHALL NOT fail. The scheduler SHALL write one log entry with the event `job_send_unsaved`, the job, the scheduled date and the part, and with no message content.

Rationale: the scheduler runs a job at least once for each scheduled date. A run whose outcome could not be saved is run again, and without a record of what it sent, it would send its message a second time.

#### Scenario: Happy path — a second run sends nothing
- **GIVEN** a job `hello` that sends the text `hi` through the send record, with the part `greeting`, and its run for `2026-09-30` sent the message
- **WHEN** `hello` runs again for `2026-09-30`
- **THEN** Telegram receives nothing more, and the job is told the message was already sent
- **AND** the record for `hello`, `2026-09-30` and `greeting` holds the chat id `-1001` and the id of the first message

#### Scenario: Failure — the send fails
- **GIVEN** a job `hello` whose send fails on its run for `2026-09-30`
- **WHEN** the run ends
- **THEN** the job received the error, and no record exists for `hello`, `2026-09-30` and `greeting`
- **AND** when `hello` runs again for `2026-09-30` and the send succeeds, Telegram receives the message once

#### Scenario: Edge case — the record cannot be saved
- **GIVEN** a job `hello` whose send succeeds, and storing the record then fails
- **WHEN** the run ends
- **THEN** the job did not fail, and Telegram received the message once
- **AND** one log entry holds the event `job_send_unsaved`, the job `hello`, the scheduled date `2026-09-30` and the part `greeting`, and no message text

#### Scenario: Edge case — parts and dates are separate keys
- **GIVEN** a job `backup` that sends one message with the part `entries` and one with the part `keywords`
- **WHEN** it runs for `2026-09-30`, runs again for `2026-09-30`, and then runs for `2026-10-01`
- **THEN** Telegram receives four messages: both parts for `2026-09-30` once, and both parts for `2026-10-01` once
