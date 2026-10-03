## ADDED Requirements

### Requirement: Bot identity ready for the configuration file
The `bot-info` step of the setup script SHALL accept the option `--escaped`. With it, the step SHALL print the bot's identity as one line that is a JSON string holding the identity's JSON, so that the line can be pasted as the value of `BOT_INFO` in the Worker's configuration file without editing. Without the option the step SHALL print the identity as before. The setup guide SHALL show an example of the `BOT_INFO` value and name this option.

#### Scenario: Escaped identity
- **WHEN** the operator runs the `bot-info` step with `--escaped` and a valid bot token
- **THEN** the script prints one line that starts with `"{\"id\":` and exits with status 0
- **AND** a configuration file with that line as the value of `BOT_INFO` is valid, and the setting parses to the bot's identity

### Requirement: Replies to a command SHALL survive a deleted command message
A reply that a command sends to the command message SHALL ask Telegram to send it even when that message no longer exists. This holds for the replies of `/ping`, `/help`, `/today`, `/week`, `/month`, `/export` and `/undo`: each reply's reply parameters SHALL hold the command message's id and `allow_sending_without_reply` set to true.

Rationale: without it, Telegram refuses a reply to a deleted message, the attempt fails, and every retry fails the same way until the update is parked. `/undo` has already removed the entry by the time it replies.

#### Scenario: Happy path — /ping replies to its command
- **WHEN** a member sends `/ping`
- **THEN** the reply's reply parameters are the command message's id with `allow_sending_without_reply` set to true

#### Scenario: Edge case — every command reply
- **WHEN** a member sends `/help`, `/today`, `/week`, `/month`, `/export` or `/undo`, and the command gets a text or a file in reply
- **THEN** that reply's reply parameters are the command message's id with `allow_sending_without_reply` set to true

### Requirement: Calls to Telegram SHALL time out and wait out a short rate limit
Every call that the gateway or the scheduler makes to Telegram SHALL be aborted when no answer has come after 20 seconds. When Telegram refuses a call with error 429 and a `retry_after` of at most 10 seconds, the call SHALL wait that many seconds and be made once more, inside the same attempt, and the answer to the second call SHALL be used as it is. A 429 with a longer `retry_after`, or without one, SHALL be returned at once, like any other error.

Rationale: grammY's own timeout is 500 seconds, longer than the gateway's 120-second update lease, so a hung call could let a redelivery run the handlers a second time. Before this, a short rate limit failed the attempt, and three in a row parked the update. One call now takes at most 50 seconds, so a handler that makes two calls ends inside the lease.

#### Scenario: Happy path — a short rate limit is waited out
- **GIVEN** Telegram answers a call with error 429 and a `retry_after` of 3 seconds, and answers the next call normally
- **WHEN** the call is made
- **THEN** it is made a second time after 3 seconds, and the second answer is the call's result

#### Scenario: Failure — a long rate limit
- **GIVEN** Telegram answers a call with error 429 and a `retry_after` of 11 seconds
- **WHEN** the call is made
- **THEN** it is made once and fails with that error

#### Scenario: Edge case — a second rate limit in a row
- **GIVEN** Telegram answers a call with error 429 and a `retry_after` of 1 second, and the next call with error 429 again
- **WHEN** the call is made
- **THEN** it is made twice and fails with the second error

#### Scenario: Edge case — both clients wait
- **GIVEN** Telegram answers the first call with error 429 and a `retry_after` of 0 seconds
- **WHEN** the gateway answers a button press, or a job sends a message
- **THEN** the call is made a second time and the press is answered, or the run is `done` with 1 attempt

#### Scenario: Edge case — the timeout
- **WHEN** the gateway or the scheduler makes a call to Telegram
- **THEN** the call's timeout is 20 seconds

### Requirement: Failed attempts SHALL be logged with a reason code
The gateway's log entry `attempt_failed` SHALL hold a `reason`: `telegram_<code>` when Telegram refused a call with that error code, `telegram_unreachable` when a call to Telegram got no answer or timed out, `database` for an error from the database, and `other` for any other error. The entry SHALL NOT hold the error message, which is recorded only in the update's record.

Rationale: the reason shows in the Cloudflare logs what kind of failure it was, without the message text that an error can carry.

#### Scenario: Failure — a handler fails
- **GIVEN** a handler fails with the error `lunch 250 by Ana`
- **WHEN** the update's first attempt ends
- **THEN** one log entry is `{"event":"attempt_failed","update_id":<id>,"attempt":1,"status":500,"reason":"other"}`
- **AND** no log entry contains `lunch 250 by Ana`

## MODIFIED Requirements

### Requirement: Button routing
The gateway SHALL treat button data as a prefix and a payload separated by the first colon. It SHALL route a button press to the handler registered for the prefix, together with the payload. It SHALL answer a press whose prefix is not registered, or whose data has no colon, with the notice `This button no longer works.` and SHALL post no chat message for it. When Telegram refuses that answer, as it does for a press that is too old to answer, the update SHALL NOT fail: the gateway SHALL write one log entry with the event `callback_answer_failed` and the update id.

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

#### Scenario: Unknown prefix, pressed too late to answer
- **GIVEN** Telegram refuses to answer the press with `Bad Request: query is too old and response timeout expired or query ID is invalid`
- **WHEN** a member presses a button whose prefix no module registered
- **THEN** the update is handled without an error, and one log entry has the event `callback_answer_failed` and the update id

#### Scenario: Data without a usable prefix
- **WHEN** a member presses a button whose data is missing, is empty, contains no colon, or starts with a colon
- **THEN** the press is answered with the notice `This button no longer works.`
- **AND** no handler runs and no chat message is posted

### Requirement: Job registration
The gateway SHALL record the jobs that modules register, each with a name and a schedule that is daily at an hour, weekly on a weekday at an hour, or monthly on a day at an hour. A job MAY also give a catch-up window, as a whole number of hours, and MAY ask for a failure alert. This capability SHALL NOT run jobs.

#### Scenario: Job is recorded
- **WHEN** a module registers a job
- **THEN** the job is available from the gateway's registry with its name, schedule, catch-up window and failure alert as given, and its owning module

#### Scenario: Job is not run
- **WHEN** a module has registered a job and a message handler, and a member's message is handled
- **THEN** the message handler runs
- **AND** the job has not run
