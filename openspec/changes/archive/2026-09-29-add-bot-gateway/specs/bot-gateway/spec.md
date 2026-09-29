## Purpose

The bot gateway receives Telegram updates for the household expense bot. It admits only verified requests from the one allowed group and its members, processes each update at most once, and gives feature modules one place to register their handlers.

## ADDED Requirements

### Requirement: Webhook request verification
The gateway SHALL accept updates only as `POST` requests to `/webhook` that carry the configured secret in the `X-Telegram-Bot-Api-Secret-Token` header. It SHALL check the secret before it reads the request body or stores anything. The comparison MUST NOT end early when the two values differ, whether in content or in length. A request that fails the check SHALL receive status 401 with an empty body.

#### Scenario: Missing secret header
- **WHEN** a `POST /webhook` request arrives without the secret header
- **THEN** the response status is 401 with an empty body
- **AND** the request body has not been read, nothing is stored, no handler runs and the bot sends nothing

#### Scenario: Wrong secret
- **WHEN** a `POST /webhook` request arrives with a secret that has the right length and the wrong content
- **THEN** the response status is 401 with an empty body
- **AND** the request body has not been read, nothing is stored, no handler runs and the bot sends nothing

#### Scenario: Secret of a different length
- **WHEN** a `POST /webhook` request arrives with a secret that is shorter or longer than the configured one
- **THEN** the response status is 401 with an empty body
- **AND** nothing is stored

#### Scenario: Comparison is not skipped for a different length
- **WHEN** the received secret has a different length from the configured one
- **THEN** the gateway still performs exactly one constant-time comparison, between two values of equal length, before it rejects the request

#### Scenario: Comparison runs in full for wrong content
- **WHEN** the received secret has the right length and the wrong content
- **THEN** the gateway performs exactly one constant-time comparison, between two values of equal length, before it rejects the request

#### Scenario: No secret configured
- **WHEN** the configured secret is missing or empty and a request arrives, with or without a secret header
- **THEN** the response status is 401 with an empty body
- **AND** nothing is stored

#### Scenario: Unknown path or method
- **WHEN** a request arrives for a path other than `/webhook`, or for `/webhook` with a method other than `POST`
- **THEN** the response status is 404
- **AND** nothing is stored

### Requirement: Configuration validation
The gateway SHALL validate its configuration before it processes a verified request. The configuration consists of the bot token, the bot identity with a numeric id and a username, a member list holding one or more numeric user ids, and the household timezone as a timezone name that the runtime accepts. A numeric user id is a positive whole number, given as a number or as a string of digits. When any setting is missing or invalid, the gateway SHALL answer with status 500 without a `Retry-After` header, write one log entry that names the setting, and process nothing.

#### Scenario: Member list is invalid
- **WHEN** a verified request arrives and the member list is missing, empty, or contains a value that is not a numeric user id, such as a negative number, a fraction or a word
- **THEN** the response status is 500 without a `Retry-After` header, and one log entry names the member list setting
- **AND** nothing is stored and no handler runs

#### Scenario: Member list holds ids as strings of digits
- **WHEN** a verified request arrives from a member and the member list gives that member's id as a string of digits
- **THEN** the update is accepted

#### Scenario: Member list holds a duplicate id
- **WHEN** the member list holds the same user id twice
- **THEN** the configuration is valid and that user is a member

#### Scenario: Bot identity is invalid
- **WHEN** a verified request arrives and the bot identity is missing, is not valid JSON, or lacks a numeric id or a username
- **THEN** the response status is 500 and one log entry names the bot identity setting
- **AND** nothing is stored and no handler runs

#### Scenario: Timezone is invalid
- **WHEN** a verified request arrives and the household timezone is missing, or is a name the runtime does not accept, such as `Mars/Olympus`
- **THEN** the response status is 500 and one log entry names the timezone setting
- **AND** nothing is stored and no handler runs

#### Scenario: Bot token is missing
- **WHEN** a verified request arrives and the bot token is missing or empty
- **THEN** the response status is 500 and one log entry names the bot token setting
- **AND** nothing is stored and no handler runs

### Requirement: Acknowledgement of updates that cannot be processed
The gateway SHALL answer a verified request that it cannot process as an update with status 200 and an empty body. It SHALL NOT store the request, run a handler, or send anything to Telegram. The supported update types are `message`, `edited_message` and `callback_query`.

#### Scenario: Body is not valid JSON
- **WHEN** a verified request arrives whose body is not valid JSON
- **THEN** the response status is 200 with an empty body
- **AND** nothing is stored and no handler runs

#### Scenario: Body is JSON but not an update
- **WHEN** a verified request arrives whose body is valid JSON and is `null`, an array, a number, a string, or an object without a numeric update id
- **THEN** the response status is 200 with an empty body
- **AND** nothing is stored and no handler runs

#### Scenario: Unsupported update type
- **WHEN** a verified request carries an update of any type other than `message`, `edited_message` or `callback_query`
- **THEN** the response status is 200 with an empty body
- **AND** nothing is stored and no handler runs

#### Scenario: Update with malformed fields
- **WHEN** a verified request carries a supported update whose content is not an object, whose message has no chat with a numeric id, whose sender has a numeric id and no first name, whose migration field is not a number, or which holds more than one of `message`, `edited_message` and `callback_query`
- **THEN** the response status is 200 with an empty body
- **AND** nothing is stored and no handler runs

### Requirement: Chat and member allowlist
The gateway SHALL process an update only when it belongs to the allowed group chat and its sender is a member. The one exception is a migration notice that is applied under Supergroup migration. The allowed chat is the chat id held in the gateway's stored settings, read for each update so that a change takes effect without a redeploy. The members are the user ids in the member list. The gateway SHALL ignore every other update. To ignore an update means to answer with status 200 and an empty body, run no handler, send nothing to Telegram, and store nothing.

#### Scenario: Member in the allowed chat
- **WHEN** a member sends a message in the allowed chat
- **THEN** the update is recorded in the update log and passed to the handlers
- **AND** the response status is 200 with an empty body

#### Scenario: Update from another chat
- **WHEN** a message arrives from a group chat other than the allowed chat, even when its sender is a member
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs, the bot sends nothing and nothing is stored

#### Scenario: Member writes to the bot in a private chat
- **WHEN** a member sends a message to the bot in a private chat
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs, the bot sends nothing and nothing is stored

#### Scenario: Non-member in the allowed chat
- **WHEN** a message arrives in the allowed chat from a user who is not in the member list
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs, the bot sends nothing and nothing is stored

#### Scenario: Button press by a non-member
- **WHEN** a button press arrives from a user who is not in the member list, on a message in the allowed chat
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs, the button press is not answered and nothing is stored

#### Scenario: Sender identity is hidden
- **WHEN** a message arrives in the allowed chat that was sent anonymously by a group administrator or on behalf of a chat or channel
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored, because the sender's user id is not a member's

#### Scenario: Message without a sender
- **WHEN** a message arrives in the allowed chat that has no sender
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored

#### Scenario: No allowed chat is set
- **WHEN** the stored settings hold no allowed chat id and a member sends a message in any chat
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored

#### Scenario: Stored chat id is not a number
- **WHEN** the stored settings hold an allowed chat id that is not a whole number, and a member sends a message in any chat
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored

#### Scenario: Guest or business message
- **WHEN** a message arrives that is marked as a guest message or as belonging to a business connection, and its chat id equals the allowed chat id
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored

#### Scenario: Button press without a chat
- **WHEN** a button press arrives that has no message with a chat, such as a press on an inline message
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs, the button press is not answered and nothing is stored

#### Scenario: Redelivery after the sender left the member list
- **WHEN** an update was recorded, its sender is then removed from the member list, and Telegram delivers the update again
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and the record is unchanged

### Requirement: Ignored updates are logged without content
The gateway SHALL write one log entry for each ignored update, holding the update id and the reason it was ignored. The entry MUST NOT contain message text, a user's name or a username.

#### Scenario: Ignored update is logged
- **WHEN** an update is ignored because its chat is not the allowed chat
- **THEN** exactly one log entry records the update id and the reason
- **AND** the entry contains neither the message text nor the sender's name or username

### Requirement: Update log
The gateway SHALL record each accepted update before any handler runs. The record SHALL hold the update id, the update type, the chat id, the sender's user id, the request body exactly as received, the time it was first received, the number of attempts and the processing status. Timestamps SHALL be stored in UTC. Recorded updates SHALL NOT be deleted.

#### Scenario: Accepted update is recorded
- **WHEN** an accepted update arrives for the first time
- **THEN** the update log holds one record for its update id, with the request body exactly as received, the type, the chat id, the sender's user id and the time received in UTC
- **AND** the record exists, with status `processing`, when the first handler runs

#### Scenario: Successful update is marked done
- **WHEN** every handler for an accepted update finishes without an error
- **THEN** the record's status is `done` with 1 attempt
- **AND** the response status is 200 with an empty body

#### Scenario: Update that no handler takes is marked done
- **WHEN** a member sends a command that no module registered, or sends a message while no message handler is registered
- **THEN** the record's status is `done` with 1 attempt
- **AND** the response status is 200 with an empty body and the bot sends nothing

### Requirement: At-most-once processing
The gateway SHALL identify an update by its exact update id. After an update has been processed successfully, no handler SHALL run for it again.

#### Scenario: Processed update is redelivered
- **WHEN** Telegram redelivers an update whose record has status `done`
- **THEN** no handler runs and the bot sends nothing
- **AND** the response status is 200 with an empty body and the record is unchanged

#### Scenario: Update id lower than earlier ones
- **WHEN** an accepted update arrives whose update id is lower than ids already in the update log and is not itself in the log
- **THEN** its handlers run and its record's status is `done`

#### Scenario: Outcome cannot be recorded after success
- **WHEN** every handler for an update finishes without an error and recording the outcome then fails
- **THEN** the response status is 200 with an empty body, so that Telegram does not deliver the update again

### Requirement: Retry on redelivery
Each time the gateway starts processing an update counts as one attempt. When a handler fails on the first or second attempt, the gateway SHALL record the failure with the error message, cut to 500 characters, and answer with status 500 and a `Retry-After` header of 5 seconds, so that Telegram redelivers the update. When a failed update is redelivered, the gateway SHALL run every handler for it again.

#### Scenario: Handler fails on the first attempt
- **WHEN** a handler fails while processing an update for the first time
- **THEN** the record's status is `failed` with 1 attempt and the error message
- **AND** the response status is 500 with a `Retry-After` header of 5 seconds

#### Scenario: Retry succeeds
- **WHEN** Telegram redelivers an update whose record has status `failed` and every handler now finishes without an error
- **THEN** the record's status is `done` with 2 attempts
- **AND** the response status is 200 with an empty body

#### Scenario: Every handler runs again on a retry
- **WHEN** two handlers are registered for an update, the first succeeded and the second failed on the first attempt, and the update is redelivered
- **THEN** both handlers run again

#### Scenario: Failure cannot be recorded
- **WHEN** a handler fails and recording the failure then fails
- **THEN** the response status is 503 without a `Retry-After` header
- **AND** the record's status stays `processing`

#### Scenario: Long error message is cut
- **WHEN** a handler fails with an error message of more than 500 characters
- **THEN** the record holds the first 500 characters of the message

### Requirement: Parking after three failed attempts
The gateway SHALL park an update whose third attempt fails. It SHALL answer a parked update with status 200 so that Telegram stops redelivering it and later updates from the chat are not held back. No handler SHALL run for a parked update.

#### Scenario: Third attempt fails
- **WHEN** a handler fails on the third attempt of an update
- **THEN** the record's status is `parked` with 3 attempts and the error message
- **AND** the response status is 200 with an empty body

#### Scenario: Parked update is redelivered
- **WHEN** an update whose record has status `parked` arrives again
- **THEN** no handler runs and the record is unchanged
- **AND** the response status is 200 with an empty body

#### Scenario: Failed record that has used three attempts
- **WHEN** an update arrives whose record has status `failed` and has used 3 attempts
- **THEN** no handler runs and the record's status becomes `parked`
- **AND** the response status is 200 with an empty body

### Requirement: Recovery of abandoned attempts
An attempt that neither finished nor failed, for example because the Worker was stopped, SHALL become retryable once more than 120 seconds have passed since it started, when the update has used fewer than 3 attempts. With 3 attempts used, the update SHALL be parked instead. Until more than 120 seconds have passed, the gateway SHALL treat a redelivery as a duplicate of an attempt in progress and SHALL NOT run a handler. When an update cannot be claimed and its record is in a state that no other requirement names, the gateway SHALL answer as for an attempt in progress, so that a later delivery can claim it.

#### Scenario: Duplicate while an attempt is in progress
- **WHEN** an update arrives whose record has status `processing` and whose attempt started 120 seconds ago or less
- **THEN** no handler runs and the record is unchanged
- **AND** the response status is 503 with a `Retry-After` header of 5 seconds

#### Scenario: Attempt started exactly 120 seconds ago
- **WHEN** an update arrives whose record has status `processing` and whose attempt started exactly 120 seconds ago
- **THEN** no handler runs
- **AND** the response status is 503 with a `Retry-After` header of 5 seconds

#### Scenario: Abandoned attempt is retried
- **WHEN** an update arrives whose record has status `processing`, whose attempt started more than 120 seconds ago, and which has used fewer than 3 attempts
- **THEN** the handlers run and the attempt count increases by 1

#### Scenario: Abandoned third attempt is parked
- **WHEN** an update arrives whose record has status `processing`, whose attempt started more than 120 seconds ago, and which has used 3 attempts
- **THEN** no handler runs and the record's status becomes `parked`
- **AND** the response status is 200 with an empty body

#### Scenario: Record changed between the claim and the read
- **WHEN** an update cannot be claimed and its record is then read as `failed` with fewer than 3 attempts, or is not found
- **THEN** the gateway decides as for an attempt in progress

### Requirement: Database unavailable
The gateway SHALL answer with status 503 when it cannot reach the database before an update has been claimed. It SHALL NOT run a handler in that case. A 503 that is caused by the database SHALL NOT carry a `Retry-After` header, so that Telegram's own growing delay applies.

#### Scenario: Settings cannot be read
- **WHEN** a verified request carries an update and reading the stored settings fails
- **THEN** the response status is 503 without a `Retry-After` header
- **AND** no handler runs and the bot sends nothing

#### Scenario: Update cannot be claimed
- **WHEN** a verified request carries an update from a member in the allowed chat, the stored settings are read, and claiming the update fails
- **THEN** the response status is 503 without a `Retry-After` header
- **AND** no handler runs and the bot sends nothing

### Requirement: Member records
The gateway SHALL keep one record per member, mapping the Telegram user id to a display name. The display name is the sender's first name as Telegram reports it. The gateway SHALL refresh the record from each accepted update before the handlers run, and SHALL give each handler the sender's user id and display name. Membership SHALL be decided by the member list alone, never by the presence of a member record.

#### Scenario: First update from a member
- **WHEN** the first accepted update from a member arrives
- **THEN** a member record holds that user id with the sender's first name as display name

#### Scenario: Member changed their name
- **WHEN** an accepted update arrives from a member whose first name differs from the recorded display name
- **THEN** the record holds the new name when the handlers run

#### Scenario: Handler reads the sender
- **WHEN** a handler runs for an accepted update
- **THEN** it reads the sender's user id and display name, and they match the update's sender

#### Scenario: Ignored update leaves no member record
- **WHEN** an update from a non-member is ignored
- **THEN** the response status is 200 with an empty body
- **AND** no member record exists for that user

#### Scenario: Member record without membership
- **WHEN** a user has a member record and is not in the member list, and sends a message in the allowed chat
- **THEN** the response status is 200 with an empty body
- **AND** no handler runs and nothing is stored

### Requirement: Supergroup migration
The gateway SHALL follow the allowed group when Telegram upgrades it to a supergroup. It SHALL replace the stored allowed chat id with the supergroup's chat id when it receives either migration notice: a notice in the allowed chat naming the new chat id, or a notice in the new chat naming the allowed chat as the old one. It SHALL apply a migration notice whoever its sender is. A notice that is applied SHALL be recorded in the update log and applied at most once. No handler SHALL run for a migration notice, no member record SHALL be refreshed from it, and the bot SHALL send nothing in response. A notice that is not applied SHALL be ignored like any other update.

#### Scenario: Notice arrives in the old group
- **WHEN** a message in the allowed chat carries a `migrate_to_chat_id`
- **THEN** the stored allowed chat id becomes that value, without a redeploy
- **AND** the update log holds a record for the notice with status `done`, and the response status is 200 with an empty body

#### Scenario: Notice arrives in the new supergroup first
- **WHEN** a message arrives in another chat, from a sender who is not a member, carrying a `migrate_from_chat_id` equal to the allowed chat id
- **THEN** the stored allowed chat id becomes the id of the chat the message arrived in
- **AND** the update log holds a record for the notice with status `done`

#### Scenario: Migration notice reaches no handler
- **WHEN** a migration notice is applied and a message handler is registered
- **THEN** the handler does not run, the bot sends nothing and no member record is created

#### Scenario: Second notice has no further effect
- **WHEN** one migration notice has been applied and the other notice for the same migration arrives
- **THEN** the stored allowed chat id is unchanged and the second notice leaves no record
- **AND** the response status is 200 with an empty body

#### Scenario: Applied notice is redelivered
- **WHEN** a migration notice whose record has status `done` arrives again
- **THEN** the stored allowed chat id and the record are unchanged
- **AND** the response status is 200 with an empty body

#### Scenario: Updates after the migration
- **WHEN** the allowed chat id has been replaced and a member sends a message in the supergroup
- **THEN** the message is recorded and passed to the handlers
- **AND** a later message from the old group chat id is answered with status 200 and leaves no record

#### Scenario: Migration notice for an unrelated chat
- **WHEN** a migration notice arrives that neither comes from the allowed chat nor names it as the old chat
- **THEN** the stored allowed chat id is unchanged and nothing is stored
- **AND** the response status is 200 with an empty body

### Requirement: Feature module registration
The gateway SHALL let each feature module register commands, button prefixes, message handlers, edited-message handlers, jobs and status lines. The deployed bot SHALL be built from one registration list, and the gateway SHALL route updates only to registered handlers. That adding a module changes no gateway file other than the registration list is verified by review.

#### Scenario: Module is added
- **WHEN** a module that registers a command is added to the registration list
- **THEN** a member can run that command and `/help` lists it

#### Scenario: Deployed bot uses the registration list
- **WHEN** a member sends `/help` to the bot as it is deployed
- **THEN** the reply lists `/ping` and `/help`

### Requirement: Registration validation
The gateway SHALL refuse to start when registrations conflict or are invalid, and the error SHALL name the conflicting value and the modules involved. A command name MUST be 1 to 32 characters of lowercase letters, digits and underscores, and MUST have a description. A button prefix MUST be 1 to 8 characters of lowercase letters and digits. Module names, command names, button prefixes and job names MUST each be unique across all modules.

#### Scenario: Duplicate command name
- **WHEN** two modules register a command with the same name
- **THEN** the gateway fails to start with a registration error that names the command and both modules

#### Scenario: Invalid command name
- **WHEN** a module registers a command whose name contains an uppercase letter, a slash or more than 32 characters
- **THEN** the gateway fails to start with a registration error that names the command and the module

#### Scenario: Command without a description
- **WHEN** a module registers a command with an empty description
- **THEN** the gateway fails to start with a registration error that names the command and the module

#### Scenario: Duplicate button prefix
- **WHEN** two modules register the same button prefix
- **THEN** the gateway fails to start with a registration error that names the prefix and both modules

#### Scenario: Invalid button prefix
- **WHEN** a module registers a button prefix that is empty, contains a colon or an uppercase letter, or is longer than 8 characters
- **THEN** the gateway fails to start with a registration error that names the prefix and the module

#### Scenario: Duplicate job name
- **WHEN** two modules register a job with the same name
- **THEN** the gateway fails to start with a registration error that names the job and both modules

#### Scenario: Duplicate module name
- **WHEN** two modules in the registration list have the same name
- **THEN** the gateway fails to start with a registration error that names the module

#### Scenario: Valid registrations
- **WHEN** two modules register different commands, prefixes and jobs
- **THEN** the gateway starts, and each registration is kept with the name of its module, in registration order

### Requirement: Command routing
The gateway SHALL route a new text message that starts with a registered command to that command's handler, together with the text that follows the command. A command name SHALL be matched exactly, so a command written in another letter case is an unknown command. The gateway SHALL accept a command addressed to this bot by username, and SHALL compare the username without regard to case. It SHALL ignore unknown commands and commands addressed to another bot, without a reply. A text message that starts with a command SHALL NOT reach the message handlers. A command inside a photo caption SHALL be treated as an ordinary message.

#### Scenario: Registered command
- **WHEN** a member sends `/ping` in the allowed chat
- **THEN** the handler registered for `ping` runs
- **AND** no message handler runs

#### Scenario: Command with arguments
- **WHEN** a member sends a registered command followed by text
- **THEN** the handler receives the text after the command, without white space at its start or end

#### Scenario: Command followed only by white space
- **WHEN** a member sends a registered command followed only by spaces or a line break
- **THEN** the handler runs and receives empty text

#### Scenario: Command addressed to this bot
- **WHEN** a member sends `/ping@` followed by this bot's username in any letter case
- **THEN** the handler registered for `ping` runs

#### Scenario: Command addressed to another bot
- **WHEN** a member sends `/ping@` followed by another bot's username
- **THEN** the update is handled without an error
- **AND** no command handler and no message handler runs, and the bot sends nothing

#### Scenario: Command in another letter case
- **WHEN** a member sends `/PING` and a module registered the command `ping`
- **THEN** the update is handled without an error
- **AND** no command handler and no message handler runs, and the bot sends nothing

#### Scenario: Unknown command
- **WHEN** a member sends a command that no module registered
- **THEN** the update is handled without an error
- **AND** no command handler and no message handler runs, and the bot sends nothing

#### Scenario: Command in a photo caption
- **WHEN** a member sends a photo whose caption starts with a registered command
- **THEN** the command's handler does not run
- **AND** the message handlers run

### Requirement: Button routing
The gateway SHALL treat button data as a prefix and a payload separated by the first colon. It SHALL route a button press to the handler registered for the prefix, together with the payload. It SHALL answer a press whose prefix is not registered, or whose data has no colon, with the notice `This button no longer works.` and SHALL post no chat message for it.

#### Scenario: Registered prefix
- **WHEN** a member presses a button with data `x:42:food` and a module registered the prefix `x`
- **THEN** that module's handler runs and receives the payload `42:food`

#### Scenario: Empty payload
- **WHEN** a member presses a button with data `x:` and a module registered the prefix `x`
- **THEN** that module's handler runs and receives an empty payload

#### Scenario: Unknown prefix
- **WHEN** a member presses a button whose prefix no module registered
- **THEN** the press is answered with the notice `This button no longer works.`
- **AND** no handler runs and no chat message is posted

#### Scenario: Data without a usable prefix
- **WHEN** a member presses a button whose data is missing, is empty, contains no colon, or starts with a colon
- **THEN** the press is answered with the notice `This button no longer works.`
- **AND** no handler runs and no chat message is posted

### Requirement: Message routing
The gateway SHALL pass each new message that does not start with a command to every registered message handler, one after another in registration order. It SHALL pass each edited message to every registered edited-message handler, in registration order, and to no other handler. When a handler fails, the handlers after it SHALL NOT run.

#### Scenario: Message without a command
- **WHEN** a member sends a message that does not start with a command and two message handlers are registered
- **THEN** both handlers run, in the order they were registered

#### Scenario: Edited message
- **WHEN** a member edits a message
- **THEN** the edited-message handlers run
- **AND** no message handler and no command handler runs, even when the edited text starts with a command

#### Scenario: No handler is registered
- **WHEN** a member sends a message and no message handler is registered
- **THEN** the update is handled without an error and the bot sends nothing

#### Scenario: Handler failure stops later handlers
- **WHEN** two message handlers are registered and the first fails
- **THEN** the second does not run
- **AND** the first handler's error is passed on, so that the attempt fails

### Requirement: Job registration
The gateway SHALL record the jobs that modules register, each with a name and a schedule that is daily at an hour, weekly on a weekday at an hour, or monthly on a day at an hour. This capability SHALL NOT run jobs.

#### Scenario: Job is recorded
- **WHEN** a module registers a job
- **THEN** the job is available from the gateway's registry with its name, schedule and owning module

#### Scenario: Job is not run
- **WHEN** a module has registered a job and a message handler, and a member's message is handled
- **THEN** the message handler runs
- **AND** the job has not run

### Requirement: Ping command
The gateway SHALL provide a `/ping` command. When the database check succeeds, the command SHALL answer with exactly one message, sent as a reply to the command. The reply SHALL start with four lines, in this order: the bot's name and version, that the database answered and how long it took in whole milliseconds, the time the most recent earlier accepted update was received, and the parked updates. Times SHALL be shown in the household timezone as a short month name, the day without a leading zero, and 24-hour time with two digits each for the hour and the minute. Parked updates SHALL be reported as `none`, or as a count followed by the ids of up to 5 of them, ordered by the time they were received with the most recent first, and by update id with the highest first when the times are equal. After the four lines, the reply SHALL show the status lines that modules registered, in registration order. When a module's status lines cannot be produced, the reply SHALL show one line that says so for that module, and SHALL still be sent.

#### Scenario: Healthy bot
- **WHEN** a member sends `/ping`, an earlier update was received on 29 September at 18:05 household time, no update is parked, and no module registered status lines
- **THEN** the bot replies once, to the command message, with exactly these four lines, where `12` stands for the measured duration as a whole number of milliseconds, 0 or more:

```
🏓 expense-bot 0.1.0
Database: ok · 12 ms
Last update: Sep 29, 18:05
Parked updates: none
```

#### Scenario: No earlier update
- **WHEN** a member sends `/ping` and the update log holds no other update
- **THEN** the third line reads `Last update: none yet`

#### Scenario: Parked updates exist
- **WHEN** a member sends `/ping` and the updates `1001` and `1002` are parked, of which `1002` was received later
- **THEN** the fourth line reads `Parked updates: 2 · 1002, 1001`

#### Scenario: Most recent parked update has the lowest id
- **WHEN** a member sends `/ping` and the updates `5000` and `17` are parked, of which `17` was received later
- **THEN** the fourth line reads `Parked updates: 2 · 17, 5000`

#### Scenario: Parked updates received at the same time
- **WHEN** a member sends `/ping` and the updates `1001` and `1002` are parked and were received at the same time
- **THEN** the fourth line reads `Parked updates: 2 · 1002, 1001`

#### Scenario: More than five parked updates
- **WHEN** a member sends `/ping` and 7 updates are parked
- **THEN** the fourth line shows the count 7, followed by the ids of the 5 most recently received only

#### Scenario: Time is shown in the household timezone
- **WHEN** the household timezone is `Asia/Manila` and the most recent earlier update was received at 16:30 UTC on 29 September
- **THEN** the third line reads `Last update: Sep 30, 00:30`

#### Scenario: Day below ten
- **WHEN** the most recent earlier update was received on 5 September at 07:07 household time
- **THEN** the third line reads `Last update: Sep 5, 07:07`

#### Scenario: Module adds status lines
- **WHEN** a module registered status lines that read `Jobs: none run yet`, and a member sends `/ping`
- **THEN** the reply has the four lines followed by the line `Jobs: none run yet`

#### Scenario: Module status fails
- **WHEN** the module `scheduler` registered status lines that cannot be produced because of an error, and a member sends `/ping`
- **THEN** the bot replies once with the four lines followed by the line `scheduler: status unavailable`
- **AND** the record's status is `done`

#### Scenario: Database check fails
- **WHEN** a member sends `/ping` and the database check inside the command fails
- **THEN** the bot sends no reply and the record's status is `failed`
- **AND** the response status is 500 with a `Retry-After` header of 5 seconds

### Requirement: Help command
The gateway SHALL provide a `/help` command that answers with exactly one message, sent as a reply to the command. The reply SHALL list every registered command with its description, in registration order, and SHALL be generated from the registrations.

#### Scenario: Help lists the registered commands
- **WHEN** a member sends `/help` and only the gateway's own commands are registered
- **THEN** the bot replies once, to the command message, with exactly these lines:

```
Commands
/ping · bot status
/help · this list
```

#### Scenario: Help includes a new module's command
- **WHEN** a module that registers the command `today` with the description `spending today` is added, and a member sends `/help`
- **THEN** the reply also contains the line `/today · spending today`, after the commands of modules registered before it

#### Scenario: Module without commands
- **WHEN** a module that registers no command is added, and a member sends `/help`
- **THEN** the reply is the same as without that module

### Requirement: Setup script
The project SHALL include a setup script for the Telegram side of the setup, with the steps `bot-info`, `discover`, `secret`, `webhook` and `verify`. The script SHALL read the bot token and the webhook secret from the environment or from the local secrets file, and a value in the environment SHALL win. The secrets file holds lines of `KEY=value`. The script MUST NOT print the bot token. When a step cannot be carried out, the script SHALL print the reason and exit with a non-zero status.

#### Scenario: Bot info
- **WHEN** the operator runs the `bot-info` step with a valid bot token
- **THEN** the script prints the bot's identity as the value to use for the `BOT_INFO` setting, and exits with status 0

#### Scenario: Privacy mode is on
- **WHEN** the operator runs the `bot-info` step and Telegram reports that the bot cannot read all group messages
- **THEN** the script prints the bot's identity, and warns that privacy mode is on and says to turn it off in BotFather and then remove and re-add the bot to the group
- **AND** the script exits with status 0

#### Scenario: Discover ids
- **WHEN** the operator runs the `discover` step while no webhook is registered and updates are pending
- **THEN** the script lists each chat with its id, type and title, and each sender with their user id and first name, and exits with status 0

#### Scenario: Discover finds no pending update
- **WHEN** the operator runs the `discover` step while no webhook is registered and no update is pending
- **THEN** the script prints that no pending update was found, and says to send a message in the group and to check that privacy mode is off
- **AND** the script exits with a non-zero status

#### Scenario: Discover lists a private chat
- **WHEN** the operator runs the `discover` step and a pending update comes from a private chat, which has no title
- **THEN** the script lists that chat with the sender's first name in place of the title

#### Scenario: Discover while a webhook is registered
- **WHEN** the operator runs the `discover` step while a webhook is registered
- **THEN** the script prints that discovery needs the webhook removed first, and exits with a non-zero status without changing anything

#### Scenario: Generate a secret
- **WHEN** the operator runs the `secret` step
- **THEN** the script prints a random secret of 48 characters drawn from `A-Z`, `a-z`, `0-9`, `_` and `-`, and exits with status 0

#### Scenario: Register the webhook
- **WHEN** the operator runs the `webhook` step with an HTTPS address
- **THEN** the script registers that address with the webhook secret and with exactly the update types `message`, `edited_message` and `callback_query`, and exits with status 0

#### Scenario: Register and drop pending updates
- **WHEN** the operator runs the `webhook` step with an HTTPS address and `--drop-pending`
- **THEN** the script registers the webhook and tells Telegram to discard the updates that were pending

#### Scenario: Remove the webhook
- **WHEN** the operator runs the `webhook` step with `--delete`
- **THEN** the script removes the registered webhook, so that the `discover` step can be used, and exits with status 0

#### Scenario: Invalid webhook secret
- **WHEN** the operator runs the `webhook` step and the webhook secret is empty, longer than 256 characters, or contains a character outside `A-Z`, `a-z`, `0-9`, `_` and `-`
- **THEN** the script prints that the webhook secret is invalid and why, calls nothing, and exits with a non-zero status

#### Scenario: Address is not HTTPS
- **WHEN** the operator runs the `webhook` step with an address that does not start with `https://`
- **THEN** the script prints that the address must use HTTPS, calls nothing, and exits with a non-zero status

#### Scenario: Verify a healthy webhook
- **WHEN** the operator runs the `verify` step and the registered webhook has the expected update types and no recorded error
- **THEN** the script prints the address, the number of pending updates and that no error is recorded, and exits with status 0

#### Scenario: Verify finds a problem
- **WHEN** the operator runs the `verify` step and no webhook is registered, the update types differ from the expected ones, or Telegram recorded a delivery error 10 minutes ago or less
- **THEN** the script prints what is wrong, including Telegram's last error message when there is one, and exits with a non-zero status

#### Scenario: Verify sees an old error
- **WHEN** the operator runs the `verify` step, the webhook has the expected update types, and Telegram's last recorded delivery error is more than 10 minutes old
- **THEN** the script prints the error with its age in whole minutes, and exits with status 0

#### Scenario: Telegram rejects the token
- **WHEN** the operator runs a step that calls Telegram and Telegram rejects the bot token
- **THEN** the script prints Telegram's description, does not print the token, and exits with a non-zero status

#### Scenario: Bot token is not set
- **WHEN** the operator runs a step that calls Telegram and neither the environment nor the secrets file holds a bot token
- **THEN** the script prints that `BOT_TOKEN` is missing, calls nothing, and exits with a non-zero status

#### Scenario: Environment wins over the secrets file
- **WHEN** the environment and the secrets file both hold a bot token, and the operator runs the `bot-info` step
- **THEN** the script calls Telegram with the token from the environment

#### Scenario: Token comes from the secrets file
- **WHEN** only the secrets file holds a bot token, and the operator runs the `bot-info` step
- **THEN** the script calls Telegram with the token from the secrets file

#### Scenario: Secrets file with quotes and comments
- **WHEN** the secrets file holds blank lines, lines that start with `#`, and a bot token written between single or double quotes
- **THEN** the script skips the blank lines and the comments, and uses the token without the quotes

#### Scenario: Unknown or missing step
- **WHEN** the operator runs the script without a step, or with a step it does not know
- **THEN** the script prints the list of steps, calls nothing, and exits with a non-zero status

#### Scenario: Exit status reaches the shell
- **WHEN** the operator starts the script as a program, without a step
- **THEN** the program prints the list of steps and ends with a non-zero exit status

#### Scenario: Network failure
- **WHEN** the operator runs a step that calls Telegram and the request fails before an answer arrives
- **THEN** the script prints the error with the bot token removed, and exits with a non-zero status

### Requirement: Setup guide
The project SHALL include a setup guide that covers these steps in order: creating the bot in BotFather, turning privacy mode off and re-adding the bot, creating the database and applying the migrations, setting the secrets and the settings, storing the allowed chat id, deploying, and registering and verifying the webhook. The guide SHALL state that a member who posts anonymously or on behalf of a channel is ignored. It SHALL describe how privacy mode left on shows up and how to fix it. Every command the guide names SHALL exist in the project.

#### Scenario: Guide covers the required steps
- **WHEN** the guide is checked
- **THEN** it has one section for each of the seven steps, in the required order, followed by a troubleshooting section
- **AND** every npm script and every setup script step that the guide names exists

#### Scenario: Guide explains privacy mode, verified by review
- **WHEN** a reviewer reads the guide's troubleshooting section
- **THEN** it names privacy mode as the cause when the bot answers commands and reacts to nothing else, and gives the steps to turn it off and re-add the bot

#### Scenario: Guide warns about anonymous posting, verified by review
- **WHEN** a reviewer reads the guide
- **THEN** it states that a member who posts anonymously or on behalf of a channel is ignored

#### Scenario: Fresh setup, validated by hand
- **WHEN** an operator follows the guide with a new bot and a Cloudflare account that has no Worker or database for this project
- **THEN** a member's `/ping` in the group gets the status reply
- **AND** this scenario is validated by hand by the operator after the first deploy, because it needs a real bot and a real account
