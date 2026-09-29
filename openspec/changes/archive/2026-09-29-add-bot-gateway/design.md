## Context

See `proposal.md` for motivation and `specs/bot-gateway/spec.md` for the required behavior. This document explains how to build it.

The repository is greenfield. The constraints come from outside the project. They were checked on 2026-09-29 and are recorded, with sources, in `.claude/handoff/explore-add-bot-gateway-20260929-182731.md`.

**Telegram**

- Any non-2xx response is retried, and any 2xx response ends delivery. This is the only documented delivery guarantee.
- Telegram honours a `Retry-After` header on a failed response. This is documented in the Bot API 4.0 changelog.
- Telegram's open-source server delivers message updates one at a time per chat. A failing update holds back every later message from the group for up to 24 hours. Without `Retry-After` it retries immediately, then after about 2, 4 and 8 seconds. It waits at most 60 seconds for a response. This is observed behavior, not a documented promise.
- Update ids restart at a random number after a week without updates.
- A supergroup migration arrives as two separate updates. The one in the new supergroup is sent by `GroupAnonymousBot`, not by a member.
- A response body may carry a Bot API method call, so an acknowledgement needs an empty body.

**Cloudflare free plan**

- 10 ms of CPU time per request. Time spent waiting on the network or the database does not count.
- 50 database queries per invocation, and 100,000 rows written per day. The row limits are enforced: once exceeded, queries fail until 00:00 UTC.
- D1 has no interactive transactions. One statement is atomic, and a `batch()` is one transaction.
- A Worker that is stopped for exceeding a limit runs no cleanup code. Telegram receives status 503 (CPU limit) or 500 (uncaught exception).
- Work passed to `ctx.waitUntil` is cancelled after 30 seconds.

**grammY 1.46.0**

- It does no de-duplication.
- `bot.catch` has no effect for webhooks.
- It keeps no list of registered commands.
- Its command matching reads the message's `bot_command` entity, not the text.

## Goals / Non-Goals

**Goals**

- The gateway alone decides the HTTP status, so retry and parking behave exactly as specified.
- Every decision that can be a pure function is one, so it can be tested without a database or network.
- The gateway's own bookkeeping uses at most 6 database statements per update. That leaves at least 44 of the free plan's 50 for feature handlers.
- Later issues add files, and add lines to four shared files. They do not rewrite existing gateway code.

**Non-Goals**

- Running jobs. The registry records them for EB-09.
- Guaranteeing that a handler's side effects happen once. The gateway guarantees that a handler is not run again after success. Handlers make their own effects safe to repeat (D14).
- Alerting. `/ping` and the `verify` step are the only health checks.

## Decisions

### 1. Toolchain and pins (D1, D2, D17, D21, D63)

Dependencies are pinned exactly in `package.json`, with no `^` or `~`, and `package-lock.json` is committed. The package manager is npm (D17). pnpm blocks the install scripts that `workerd` and `esbuild` need unless they are allowlisted, which adds a setup step for no benefit here.

| Package | Version | Role |
|---|---|---|
| `grammy` | 1.46.0 | Bot framework. The only runtime dependency |
| `wrangler` | 4.143.0 | Build, local run, deploy, migrations, type generation |
| `@cloudflare/vitest-plugin` | 1.3.1 | Runs Vitest inside the Workers runtime |
| `vitest` | 4.1.11 | Test runner. The plugin requires 4.x |
| `typescript` | 7.0.2 | Type checking only |
| `@types/node` | 24.19.0 | Node.js types, which the generated runtime types expect |

These are the versions the human chose (D1). The package `name` is `expense-bot` and its `version` is `0.1.0`. `/ping` shows both.

**`@cloudflare/vitest-plugin` replaces the package the epic calls "the Workers pool" (D2).** `@cloudflare/vitest-pool-workers` was renamed after 0.22.0. The successor has the same API and pins the same `wrangler` version this project uses, so tests and deploys run the same runtime.

**Consequences of TypeScript 7.0.2.**

- `skipLibCheck` stays `true`. An open upstream issue (workers-sdk #15377) makes miniflare's declarations fail a full library check.
- `compilerOptions.types` is listed explicitly, because TypeScript 7 no longer loads every `@types` package by default. The root config lists `./worker-configuration.d.ts` and `node`. The test config lists those two and `@cloudflare/vitest-plugin/types`, because a child config's `types` replaces the parent's list.
- The settings are `target` `es2024`, `module` `es2022`, `moduleResolution` `Bundler`, `strict`, `noEmit`, `isolatedModules` and `resolveJsonModule`. All are valid in TypeScript 7.
- `include` is `["worker-configuration.d.ts", "src/**/*.ts"]` in the root config and `["./**/*.ts", "../worker-configuration.d.ts"]` in the test config (D63). The generated file is in both, so the test config has an input before any test file exists. Without it the type check of task 1.1 would fail with "No inputs were found".
- Nothing in the toolchain imports TypeScript's JavaScript API, which 7.0 does not ship. Vitest's `--typecheck` mode is not used.

**Stop rule (D32).** If the type check cannot pass under TypeScript 7.0.2 for a reason outside this project's own code, the implementer stops and reports it. The pin is a human decision and is not changed to get a green check. The type check is part of the verification of every task that writes TypeScript, so the rule can fire early.

**Wrangler configuration (D21).** The config file is `wrangler.jsonc`, with `compatibility_date` `2026-09-26`. That is the date Cloudflare's template uses, and it matches the runtime bundled with Wrangler 4.143.0. No Node.js compatibility flag is listed, because it is on by default from `2026-08-04`. Types come from `wrangler types`, which writes `worker-configuration.d.ts`. That file is generated, is not committed, and is rebuilt by the `typecheck` script. The types are generated with `--strict-vars=false` (D61). Without that flag each setting gets the literal type of its value in `wrangler.jsonc`, and a test that passes a changed copy of the environment would fail the type check.

| Key | Value |
|---|---|
| `name` | `expense-bot` |
| `main` | `src/index.ts` |
| `d1_databases[0]` | binding `DB`, database name `expense-bot`, `migrations_dir` `migrations`, and a placeholder `database_id` that the setup guide replaces |
| `vars` | `BOT_INFO`, `ALLOWED_USER_IDS` (both JSON text) and `HOUSEHOLD_TZ` (default `Asia/Manila`) |
| `secrets.required` | `BOT_TOKEN`, `WEBHOOK_SECRET` |
| `observability.enabled` | `true` |

**Scripts.**

| Script | Command |
|---|---|
| `test` | `vitest run && node --test "scripts/**/*.test.mjs"` |
| `typecheck` | `wrangler types --strict-vars=false && tsc --noEmit && tsc --noEmit -p test/tsconfig.json` |
| `dev` | `wrangler dev` |
| `deploy` | `wrangler deploy` |
| `setup` | `node scripts/setup.mjs` |
| `db:migrate:local` | `wrangler d1 migrations apply expense-bot --local` |
| `db:migrate:remote` | `wrangler d1 migrations apply expense-bot --remote` |

`npm test` is the one command that runs every test.

**The two runners are kept apart (D31).** On Node 24, `node --test` treats an argument as a file or a pattern and does not search a directory, so the script passes the pattern `scripts/**/*.test.mjs`. Vitest's default pattern would also collect those files, so `vitest.config.mts` sets `test.include` to `["test/**/*.test.ts"]`.

`.gitignore` covers `node_modules/`, `.wrangler/`, `dist/`, `worker-configuration.d.ts` and `.dev.vars*`, and keeps `.dev.vars.example`.

### 2. Layout

```
package.json  package-lock.json  tsconfig.json  wrangler.jsonc  vitest.config.mts
.gitignore  .dev.vars.example  README.md
migrations/0001_bot_gateway.sql
src/index.ts                 Worker entry: one line per handler
src/modules.ts               the registration list, one line per module
src/gateway/index.ts         createGateway and the request pipeline
src/gateway/config.ts        reads and validates configuration
src/gateway/secret.ts        secret comparison
src/gateway/classify.ts      allowlist and migration decision, a pure function
src/gateway/update-log.ts    claim, finish, fail, park, and the reads for /ping
src/gateway/members.ts       member records
src/gateway/settings.ts      stored settings
src/gateway/registry.ts      module contract, validation, routing tables
src/gateway/bot.ts           builds the grammY bot from the registry
src/core/index.ts            the gateway's own module: /ping and /help
test/                        Vitest tests and helpers, run inside the Workers runtime
scripts/setup.mjs            setup script
scripts/lib/                 setup helpers
scripts/setup.test.mjs       setup script tests, run by node --test
scripts/guide.test.mjs       setup guide check, run by node --test
docs/setup.md                setup guide
```

**Shared files (D33).** Later issues share four files and add lines or files to them: `src/modules.ts`, `src/index.ts`, `wrangler.jsonc` and `migrations/`. The epic names three. `src/index.ts` is the fourth, because a cron trigger needs a `scheduled` handler on the Worker's default export and there is no other place for it. The entry is written so that EB-09 adds one line:

```ts
const gateway = createGateway({ modules });

export default {
  fetch: gateway.fetch,
} satisfies ExportedHandler<Env>;
```

`gateway.fetch` is a closure and does not depend on `this`.

### 3. The gateway owns the response (D3, D22, D23, D36, D50)

`createGateway(options)` returns an object with a `fetch(request, env, ctx)` function.

```ts
interface GatewayOptions {
  modules: FeatureModule[];
  now?: () => Date;   // defaults to () => new Date()
}
```

`createGateway` builds and validates the registry at once, and throws `RegistrationError` when it is invalid. Because `src/index.ts` calls it at module scope, an invalid registration also makes `wrangler deploy` fail.

The pipeline runs these steps in order. Each step either ends the request or passes it on.

| Step | Check | Result when it fails |
|---|---|---|
| 1 | Method is `POST` and path is `/webhook` (D22) | 404 |
| 2 | Secret header matches (Decision 4) | 401, empty body |
| 3 | Configuration is valid (D23) | 500, logged |
| 4 | Body is a JSON object with a numeric `update_id` | 200, empty body, logged |
| 5 | Read the allowed chat id from settings | 503 if the database fails |
| 6 | Classify the update (Decision 5) | 200, empty body when ignored |
| 7 | Claim the update (Decision 6) | 200 or 503, per Decision 6 |
| 8 | For a `process` decision: refresh the member record. For a `migrate` decision: store the new chat id | attempt fails |
| 9 | For a `process` decision: run the handlers through grammY. For a `migrate` decision: run nothing (D39) | attempt fails |
| 10 | Record the outcome | per Decision 6 |

A migration notice is a service message, not something a member wrote. It reaches no handler, and no member record is refreshed from it. Its record goes to `done` once the chat id is stored.

**Error handling, by failure.**

| Failure | Where | Response | Logged as |
|---|---|---|---|
| Wrong path or method | step 1 | 404 | nothing |
| Secret missing, wrong, or not configured | step 2 | 401 | nothing |
| Configuration invalid | step 3 | 500, no `Retry-After` | `config_invalid` |
| Body is not an update | step 4 | 200 | `body_rejected` |
| Database fails before the claim | steps 5 and 7 | 503 | `database_unavailable` |
| Update is not allowed | step 6 | 200 | `update_ignored` |
| Classification throws | step 6 | 200 | `update_rejected` |
| Member refresh or chat id write fails | step 8 | per Decision 6 | `attempt_failed` |
| Handler throws | step 9 | per Decision 6 | `attempt_failed` |
| Database fails after the handlers | step 10 | per Decision 6 | `outcome_not_recorded` |
| Worker is stopped mid-attempt | any | 500 or 503, from the runtime | nothing. The lease recovers it |

`classifyUpdate` is total: it returns an `ignore` decision for any shape it does not understand, and never throws (D36). The pipeline still wraps the call. An unexpected error there is a bug in the gateway, and answering it with an error status would make Telegram redeliver the same update for up to 24 hours while the group waits behind it. The gateway logs it and answers 200 instead. The member sees no confirmation and sends the message again, which is the fallback the epic already describes for a lost update. No test can reach this branch, because the function is total and nothing can make it throw. It is verified by review.

**Log lines** are single-line JSON objects written with `console.log`. The event name is under the key `event`, and the fields are further keys of the same object:

| Event | Fields |
|---|---|
| `config_invalid` | `setting`, the environment name: `BOT_TOKEN`, `BOT_INFO`, `ALLOWED_USER_IDS` or `HOUSEHOLD_TZ` |
| `body_rejected` | none |
| `update_ignored` | `update_id`, `reason` |
| `update_rejected` | `update_id` |
| `database_unavailable` | `update_id` |
| `attempt_failed` | `update_id`, `attempt`, `status` |
| `outcome_not_recorded` | `update_id` |
| `status_failed` | `update_id`, `module` |

No log line holds message text, a name or a username.

**Why not grammY's `cloudflare-mod` adapter (D3).** The epic names it. The gateway calls `bot.handleUpdate(update)` directly instead, for three reasons found in grammY's source:

- The adapter does not catch handler errors, so the status code would come from an uncaught exception.
- Its timeout rejects the request but leaves the handler running, so a redelivery could overlap the first attempt.
- Its secret check accepts every request when no secret is configured.

*Alternative considered:* keep the adapter and put the update log in the first middleware. It needs a wrapper to turn errors into statuses, a second secret check, and the timeout disabled. That is more code than the pipeline it would replace.

*Cost:* `handleUpdate` is public, but grammY's documentation describes it as mainly for libraries and tests. The exact version pin and the tests that drive `fetch` end to end cover a change in its behavior.

**The bot is built for each admitted update (D50).** `createGateway` runs at module scope, where no environment exists, so the bot cannot be built there. `buildBot(config, state)` in `bot.ts` builds it inside the request, after the claim, with that update's state captured by closure. Nothing about an update is kept in a variable that another request can read.

*Alternative considered:* build one bot per isolate and keep the current update's state beside it. Requests interleave at every `await`, and Telegram queues button presses per user, apart from the chat's messages, so a press and a message can be in flight together. A handler would then read the other sender as the member, and EB-05 stores the member as the payer. Tests run one request at a time and would not catch it. Building the bot costs a few closures per update, which is small against the 10 ms budget.

The bot is created with `botInfo` from `BOT_INFO`, so grammY never calls `getMe`. It is created with a `fetch` option that calls the global `fetch` at call time, so tests can replace it. Webhook replies stay off, which is grammY's default. No timeout is applied, because Telegram's own 60-second limit and the lease in Decision 6 bound an attempt.

**Configuration fails closed (D23, D49).** `config.ts` reads and validates `BOT_TOKEN`, `BOT_INFO`, `ALLOWED_USER_IDS` and `HOUSEHOLD_TZ` into one typed object. `BOT_INFO` and `ALLOWED_USER_IDS` are accepted as JSON text or as already-parsed values. A user id is a positive whole number, given as a JSON number or as a string of digits. Duplicates are removed. The timezone is validated by constructing an `Intl.DateTimeFormat` with it. Invalid configuration returns 500 without a `Retry-After` header (D54). It lasts until a redeploy, so Telegram's own growing delay is the right pace. Telegram keeps the update and retries, and the error is visible to the operator through the `verify` step.

### 4. Secret check (D4, D43)

`secret.ts` encodes both values with `TextEncoder` and compares them with `crypto.subtle.timingSafeEqual`, following Cloudflare's documented pattern. When the lengths differ it compares the received value against itself and negates the result, so the check takes the same time and still fails.

An empty or missing `WEBHOOK_SECRET` rejects every request. This is deliberately the opposite of grammY's built-in check.

**Verifying "must not end early" (D43).** Timing cannot be measured reliably in the Workers runtime, where the clock does not advance during computation. The comparison function is therefore a parameter of `secretMatches`. Its default is a function that calls `crypto.subtle.timingSafeEqual(a, b)`. The default is a wrapper and not a bare reference to the method, because the Workers runtime rejects a native method that is called without its receiver. A unit test passes a recording function and asserts exactly one call with two buffers of equal length, both for a wrong secret of the same length and for a secret of a different length.

*Alternative considered:* hash both values with SHA-256 and compare the digests. It is valid, but it is not the pattern Cloudflare documents and it adds two asynchronous calls.

### 5. Allowlist and migration (D7, D8, D9, D10, D24, D36, D39, D55, D57)

`classify.ts` exports one pure function. It takes the update, the allowed chat id and the member ids, and returns one of three decisions:

```ts
type Decision =
  | { action: "ignore"; reason: IgnoreReason }
  | { action: "migrate"; kind: "message"; chatId: number; userId: number | null; newChatId: number }
  | { action: "process"; kind: UpdateKind; chatId: number; userId: number; firstName: string; username?: string };

type UpdateKind = "message" | "edited_message" | "callback_query";
type IgnoreReason =
  | "unsupported_type" | "malformed" | "no_chat" | "guest_or_business" | "no_allowed_chat"
  | "migration_already_applied" | "unrelated_migration" | "chat_not_allowed" | "sender_not_member";
```

The rules are checked in this order, and the first one that applies decides. "The message" means the `message`, the `edited_message`, or the message a button press belongs to.

1. The update has none of `message`, `edited_message` and `callback_query`: ignore, `unsupported_type` (D10).
2. The update is malformed: ignore, `malformed` (D36, D57). An update is malformed when it holds more than one of the three fields, when its content is not an object, when a `message` or `edited_message` has no chat with a numeric id, when a sender has a numeric id and no first name as text, or when a migration field is not a number.
3. A button press has no message with a chat that has a numeric id: ignore, `no_chat`.
4. The message has `guest_query_id` or `business_connection_id`: ignore, `guest_or_business` (D24). Telegram documents that such a message's chat id "may not coincide" with the bot's own chat of the same id.
5. No allowed chat id is stored: ignore, `no_allowed_chat` (D8).
6. A `message` has `migrate_to_chat_id` and its chat is the allowed chat: migrate to that id (D9).
7. A `message` has `migrate_from_chat_id` equal to the allowed chat id: migrate to the message's own chat id (D9).
8. A `message` has `migrate_to_chat_id` equal to the allowed chat id, or has `migrate_from_chat_id` and its own chat is the allowed chat: ignore, `migration_already_applied` (D39).
9. A `message` has either migration field: ignore, `unrelated_migration`.
10. The chat is not the allowed chat: ignore, `chat_not_allowed`.
11. The sender is missing, has no numeric id, or is not in the member ids: ignore, `sender_not_member`.
12. Otherwise: process.

Rules 6 and 7 come before the member check because the notice in the new supergroup is sent by `GroupAnonymousBot`. The two notices travel in different Telegram queues, so either can arrive first. After one is applied, the other matches rule 8 and is ignored.

For a `migrate` decision, `userId` is the sender's id as Telegram reports it, and `null` when the message has no sender with a numeric id (D39). For the notice in the new supergroup it is the id of `GroupAnonymousBot`.

The sender of a button press is the user who pressed it, not the author of the message.

An anonymous administrator's message arrives with the sender id of `GroupAnonymousBot` and is ignored by rule 11. The real sender's id is not in the update, so the gateway cannot do better. The setup guide says so.

**Setting the allowed chat id (D8).** The operator stores it in the `settings` table during setup. The `discover` step of the setup script finds the id, and the setup guide gives the command that stores it. A stored value that is not a whole number counts as no allowed chat (D55): `getAllowedChatId` returns `null`, and every update is ignored. *Alternatives considered:* a Wrangler variable that seeds the value would leave two sources of truth after a migration. Letting the first member who uses the bot claim the chat would make the bot answer in any group until claimed.

**The webhook subscribes to `message`, `edited_message` and `callback_query` only (D10).** Migration notices are ordinary `message` updates, so `my_chat_member` is not needed.

**Ignored updates (D7).** They are never stored. The gateway writes one `update_ignored` log line per ignored update, with the update id and the reason.

### 6. Update log (D5, D6, D14, D16, D20, D35, D37, D38, D47, D51, D54, D62)

**States.**

```
             claim                 handlers succeed
 (new) ───────────────▶ processing ────────────────▶ done
                          │   ▲
          handler fails,  │   │ claim again: redelivered,
          attempts < 3    ▼   │ and failed or lease expired
                        failed┘

 processing ── handler fails, attempts = 3 ─────────▶ parked
 processing ── lease expired, attempts = 3 ─────────▶ parked
 failed ────── found with attempts = 3 ─────────────▶ parked
```

**Attempts are counted at claim time (D5).** A Worker that is stopped mid-attempt runs no cleanup, so counting on failure would never count it. Counting at claim means that repeated kills reach the parking limit, for as long as Telegram keeps redelivering the update.

**The stored raw update is the request body text exactly as received (D47).** The pipeline reads the body once as text, parses that text, and stores the text.

**The claim is one guarded upsert.** D1 has no interactive transactions, so the decision to claim must be made inside a single statement:

```sql
INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, received_at, claimed_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'processing', 1, ?6, ?6)
ON CONFLICT (update_id) DO UPDATE SET
  status = 'processing',
  attempts = attempts + 1,
  claimed_at = excluded.claimed_at
WHERE updates.attempts < 3
  AND (updates.status = 'failed'
       OR (updates.status = 'processing' AND updates.claimed_at < ?7))
RETURNING attempts;
```

`?6` is the current time and `?7` is the current time minus the lease. The result is read with `.first()`. A row means the update was claimed, and `attempts` is the attempt number. No row means it was not claimed. `.run()` is not used for this, because it does not reliably return rows.

This statement was run against SQLite 3.53.4 for every combination of status, attempts and lease. It claims a new update, a `failed` record with 1 or 2 attempts, and a `processing` record with 1 or 2 attempts whose lease expired. It claims nothing else.

**The lease is 120 seconds, and is held at exactly 120 seconds (D37).** Telegram waits at most 60 seconds for a response, and the Workers runtime allows up to 30 seconds after the client disconnects. 120 seconds is past both, so a second attempt cannot start while the first may still be running. The guard uses `<`, so an attempt that started exactly 120 seconds ago is still in progress, and one that started more than 120 seconds ago is abandoned.

**When the claim returns no row (D38)**, the gateway reads the record's `status`, `attempts` and `claimed_at`, and the pure function `resolveUnclaimed` decides. The table is complete: the last row covers every state the others do not name.

| Record | Outcome | Action | Status |
|---|---|---|---|
| `done` or `parked` | `finished` | none | 200 |
| `processing`, lease held | `in_progress` | none | 503 with `Retry-After: 5` |
| `processing`, lease expired, 3 attempts used | `exhausted` | set `parked` with a guarded `UPDATE` | 200 |
| `failed`, 3 attempts used | `exhausted` | set `parked` with a guarded `UPDATE` | 200 |
| anything else, or no record | `in_progress` | none | 503 with `Retry-After: 5` |

The claim and the read are two statements, so the record can change between them. For example, the attempt in flight can record its failure, and the read then sees `failed` with 1 or 2 attempts. Answering 200 there would end delivery and lose the update. Answering 503 lets the next delivery claim it.

**Outcomes and statuses (D6, D35).**

| Outcome | Write | Status |
|---|---|---|
| Handlers succeed | `done`, guarded by `status = 'processing'` | 200 |
| Handlers succeed, write fails | none. The record stays `processing` | 200 |
| Handler fails, attempt 1 or 2 | `failed`, with the error message | 500 with `Retry-After: 5` |
| Handler fails, attempt 3 | `parked`, with the error message | 200 |
| Handler fails, write fails | none. The lease recovers the record | 503, no `Retry-After` |
| Database fails before the claim | none | 503, no `Retry-After` |

Every 2xx response has an empty body.

**A failed attempt asks Telegram to wait 5 seconds (D35).** Without the header, Telegram's server retries at once and then after about 2 seconds, so all three attempts would be used within seconds and a brief outage would park the update. With it, three attempts span about 10 seconds. The cost is that later messages from the group wait that long behind a failing update.

**A 503 caused by the database carries no `Retry-After` (D54).** Without the header Telegram's server lengthens its delay after each failure, up to about a minute. During an outage that is what the gateway wants: a fixed 5 seconds would bring a request every 5 seconds for as long as the database is down. The 500 for invalid configuration carries none for the same reason. Of the 503 answers, only the one for a duplicate of an attempt in progress carries the header, because that wait is short by design.

**What an abandoned attempt costs (D51).** These figures follow from the lease and from Telegram's observed behavior:

| Case | Time until the update stops holding the group |
|---|---|
| A handler fails three times | about 10 seconds |
| An attempt is killed, or its failure cannot be recorded, three times | about 6 minutes: each attempt holds the lease for 120 seconds |
| A button press is killed twice | Telegram drops a button press after about 150 seconds, so no third delivery comes |

In the last case the record stays in `processing` with 2 attempts. It is never parked and `/ping` does not show it. This is an accepted risk. The member sees no reaction and presses again, or sends the message again, which is the fallback the epic describes.

**Parking answers 200 on purpose.** A non-2xx would keep Telegram redelivering the same update, and every later message from the group would wait behind it.

**The duplicate of an attempt in progress answers 503, not 200.** If it answered 200, Telegram would stop delivering the update, and a failure of the first attempt would never be retried.

**Success wins over bookkeeping.** When the handlers succeed and the `done` write fails, the gateway answers 200. Answering with an error would make Telegram redeliver, the lease would expire, and the handlers would run a second time after a success.

**Handlers may run again (D14).** On a retry every handler for the update runs again, including those that succeeded before. This is a contract for every feature module: a handler's effects must be safe to repeat for the same update. The epic already requires this of the capture flow.

**Timestamps (D16).** All timestamps are ISO-8601 UTC text with milliseconds, such as `2026-09-29T10:05:30.123Z`, produced from the gateway's `now()`. No SQL time function is used, so tests control time by passing `now`. Text in this one fixed format sorts in time order, which the lease comparison relies on.

**Retention (D20).** Records are never deleted, in line with the epic's rule that nothing is hard-deleted. At the expected volume the table grows by a few megabytes a year.

**The stored error message (D62)** is the message of the original error that the handler threw. A message of more than 500 characters is cut to its first 500.

### 7. Data model

Migration `0001_bot_gateway.sql` creates three tables. All are `STRICT`.

```sql
CREATE TABLE updates (
  update_id   INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('message', 'edited_message', 'callback_query')),
  chat_id     INTEGER NOT NULL,
  user_id     INTEGER,
  raw         TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('processing', 'done', 'failed', 'parked')),
  attempts    INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  last_error  TEXT,
  received_at TEXT    NOT NULL,
  claimed_at  TEXT    NOT NULL,
  finished_at TEXT
) STRICT;

CREATE INDEX updates_received_at ON updates (received_at);
CREATE INDEX updates_parked ON updates (received_at) WHERE status = 'parked';

CREATE TABLE members (
  user_id       INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  username      TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

- `user_id` in `updates` is the sender's id. It is empty only for a migration notice that has no sender with a numeric id (D39).
- Telegram ids have at most 52 significant bits, so they fit a JavaScript number and a SQLite `INTEGER`.
- The allowed chat id is the `settings` row with key `allowed_chat_id`. Its value is the id as text.
- No triggers are defined, so a statement changes only the rows it names.
- `updates_parked` is ordered by `received_at`, because `/ping` lists parked updates by the time received (D40).

**Canonical forms.** Each value that is compared has one form in code and one place that converts it:

| Value | Form in code | Converted in |
|---|---|---|
| Chat id and user id | number | `settings.ts` for the stored chat id, `config.ts` for the member list |
| Update id | number, matched exactly | `index.ts`, when the body is parsed |
| Bot username in a command | compared without regard to case | grammY's command matching, and nowhere else |
| Command name and button prefix | lowercase, enforced at registration | `registry.ts` |

No other module parses or normalizes these values. `classify.ts` and the stores receive them already converted.

### 8. Member records (D11)

The display name is Telegram's `first_name`. The epic's confirmation format shows a first name, and `first_name` is the only name field Telegram always sends.

The record is refreshed with an upsert that writes only when the name or username changed. That keeps rows written low against the daily limit.

`ALLOWED_USER_IDS` alone decides membership. The `members` table caches names and is never consulted for access. A record is kept after a user leaves the member list, because later issues need the name for old entries.

The refresh and the claim are separate statements. A migration notice skips the refresh.

### 9. Registration contract (D12, D13, D34, D42, D44, D58)

`registry.ts` defines the contract that every later issue builds on.

```ts
interface FeatureModule {
  name: string;
  commands?: CommandRegistration[];
  callbacks?: CallbackRegistration[];
  messages?: UpdateHandler[];
  editedMessages?: UpdateHandler[];
  jobs?: JobRegistration[];
  status?: (ctx: BotContext) => Promise<string[]>;   // lines for /ping (D34)
}

interface CommandRegistration {
  name: string;                  // 1 to 32 of a-z, 0-9, _
  description: string;           // shown by /help
  handle: (ctx: BotContext, args: string) => Promise<void>;
}

interface CallbackRegistration {
  prefix: string;                // 1 to 8 of a-z, 0-9 (D25)
  handle: (ctx: BotContext, payload: string) => Promise<void>;
}

type UpdateHandler = (ctx: BotContext) => Promise<void>;

interface JobRegistration {
  name: string;
  schedule: JobSchedule;
  run: (job: JobContext) => Promise<void>;
}

type JobSchedule =
  | { every: "day"; hour: number }
  | { every: "week"; weekday: number; hour: number }   // 1 is Monday, 7 is Sunday
  | { every: "month"; day: number; hour: number };

interface JobContext {            // (D42)
  env: Env;
  db: D1Database;
  now: Date;
  timezone: string;
  chatId: number;                 // the allowed chat id, read when the job runs
  api: Api;                       // grammY's Telegram client
}

type BotContext = Context & {
  gateway: {                      // (D44)
    env: Env;
    db: D1Database;
    now: Date;
    timezone: string;             // the validated household timezone
    chatId: number;
    member: { userId: number; displayName: string };
    registry: Registry;
  };
};
```

`buildRegistry(modules)` validates the modules and returns a `Registry`: the commands, callbacks, message handlers, edited-message handlers, jobs and status functions, each tagged with its module's name and kept in registration order. It throws `RegistrationError` with a message that names the offending value and the modules involved.

`src/modules.ts` is the registration list:

```ts
export const modules: FeatureModule[] = [
  core,
];
```

**Handlers get the validated timezone (D44).** `/ping` needs it, and so does every later issue that handles dates. Without it each handler would read `env.HOUSEHOLD_TZ` unvalidated.

**Jobs are recorded, not run.** The epic puts jobs in the registration pattern and puts scheduled jobs out of scope for this issue. The registry therefore holds them, and checks only that job names are unique. The three schedule shapes are the ones the epic gives for EB-09. EB-09 adds the scheduler and validates schedule values.

**`JobContext` is defined now (D42).** Nothing in this change builds one. EB-10, EB-11 and EB-12 each send a message to the group with no incoming update, so each needs the database, the chat id and a Telegram client. Defining the fields here means EB-09 fills them in and does not edit the contract that three issues in its wave build on.

**Status lines (D34).** A module may register a `status` function. `/ping` calls each one in registration order and appends the lines after its own four. The epic wants EB-09 to show the last run of each job in `/ping` and does not list EB-09 as a change to this capability. Without this field EB-09 would have to rewrite `/ping`.

*Alternative considered:* leave jobs and status lines out and let EB-09 add them. EB-09 would then modify this capability's spec and its contract.

**Routing (D13).** `buildBot` in `bot.ts` installs the handlers on a grammY bot in this order:

1. A first middleware attaches `ctx.gateway`.
2. Each registered command, through grammY's command matching. That matching compares the command name exactly, so `/PING` does not match `ping` and is an unknown command (D58). It accepts `/name@ThisBot` and compares the username without regard to case, rejects `/name@OtherBot`, and applies only to new messages. grammY trims the text after the command at its start only. The gateway trims it at both ends and passes it to the handler as `args`.
3. A catch for any other new text message that starts with a command. It does nothing, so unknown commands and commands for other bots stop here and never reach the message handlers.
4. Button presses. The data is split at the first colon and the prefix is looked up. An unknown prefix, data without a colon, data that starts with a colon, or a press without data is answered with the notice `This button no longer works.` and nothing is posted to the chat (D26). The epic requires every press to be answered, and a notice is not a chat message. Data that ends with the colon gives an empty payload.
5. New messages. Every message handler runs, one after another, in registration order.
6. Edited messages. Every edited-message handler runs, in registration order.

"Starts with a command" means a new text message whose `entities` hold a `bot_command` entity at offset 0 (D28). The catch in step 3 tests for exactly that. A command inside a photo caption is an ordinary message, and a command in an edited message goes to the edited-message handlers. This follows grammY's own command matching, which covers neither.

Handlers run one after another in registration order, not in parallel (D27). When one throws, the rest do not run and the attempt fails. Running every handler, instead of stopping at the first that matches, lets each module decide for itself whether a message concerns it.

Unknown commands are ignored without a reply. In a group, a command may be meant for another bot, and the epic's first rule allows at most one bot message per message.

### 10. `/ping` and `/help` (D15, D40, D41, D48, D52)

Both live in `src/core/index.ts`, which is an ordinary module in the registration list. Both send one message with `reply_parameters.message_id` set to the id of the command message (D48).

`/ping` reports four things, then the modules' status lines:

- **Name and version**, imported from `package.json`.
- **Database**, measured as the wall-clock time of one statement whose text is exactly `SELECT 1`, rounded to a whole number of milliseconds.
- **Last update**, the newest `received_at` among the other records, formatted in the household timezone with `Intl.DateTimeFormat` for `en-US`, a short month, a numeric day without a leading zero, a 24-hour clock, and two digits each for the hour and the minute.
- **Parked updates**, the count and the ids of up to 5 parked records, ordered by `received_at` with the most recent first, and by update id with the highest first when the times are equal (D40). Ids are separated by a comma and a space. The highest id is not always the most recent, because Telegram's ids restart at a random number.

**When a status function fails (D52)**, `/ping` catches the error and shows the line `<module>: status unavailable` in place of that module's lines. The reply is still sent and the attempt succeeds. `/ping` is one of only two health checks, and a defect in one module must not remove it. The error is logged as `status_failed` with the module's name.

**When the database check fails (D41)**, the handler throws. No reply is sent, and the attempt fails and is retried like any other.

`/ping` cannot report a database that is unreachable before the handler runs, because the gateway needs the database to claim the update. In that case Telegram gets 503 and the member gets no reply. A reply to `/ping` is itself the proof that the database is reachable.

`/help` reads `ctx.gateway.registry.commands` and prints one line per command, as `/name · description`.

*Alternative considered for the version:* Cloudflare's version metadata binding, which changes on every deploy. It was not verified during exploration, so it is left as an open question.

### 11. Tests (D18, D31)

Tests run inside the Workers runtime through `@cloudflare/vitest-plugin`. They drive the gateway through `fetch` with real `Request` objects and assert on three things: the response, the rows in D1, and the calls made to Telegram.

- **Files.** `vitest.config.mts` sets `test.include` to `["test/**/*.test.ts"]`, so Vitest does not collect the Node tests under `scripts/`.
- **Gateway under test.** Tests call `createGateway({ modules, now })` with test modules, so they can register handlers that record calls or fail on demand. One test, `test/entry.test.ts`, imports the default export of `src/index.ts` instead, so the real registration list and entry are exercised.
- **Configuration.** `vitest.config.mts` sets test values for every binding through `miniflare.bindings`, so tests never depend on a local secrets file. A test of invalid configuration passes a changed copy of `env`.
- **Migrations.** The config reads `migrations/` with `readD1Migrations` into a `TEST_MIGRATIONS` binding. A setup file applies them with `applyD1Migrations`.
- **Harness tests.** `test/harness.test.ts` asserts that the three tables exist and that every binding has a value. `test/helpers.test.ts` checks the helpers themselves, without any gateway code: it drives a plain grammY bot through the update builders and the `fetch` stub, for a command with and without `@username`, a caption, an edited message and a button press. It checks both triggers of the database proxy against the real database, the header, method, path and body of a signed request, and the recording and failing of the probe module. It does not check the gateway state helper, which calls `buildRegistry` and so cannot work before task 2.4. These two files are the only tests expected to pass before section 2 of the tasks. Without them a defect in a helper would look the same as the expected red.
- **Isolation.** Storage is isolated per test file, not per test. Each test file empties the three tables before each test.
- **Telegram calls.** A helper replaces `globalThis.fetch` with a stub. It records each call as `{ method, payload }`, where `method` is the last segment of the address and `payload` is the parsed JSON body. It answers `{ "ok": true, "result": true }`, and a test can set another `result` for a method. "The bot sends nothing" means that no call was recorded. "The button press is not answered" means that no `answerCallbackQuery` call was recorded. MSW is not used: its Workers integration changed its required major version the day before this design was written.
- **Update builders.** The message builder derives `entities` from the text. For text that starts with `/`, it adds a `bot_command` entity at offset 0 whose length covers the command and any `@username`. Telegram always sends that entity, and grammY's matching needs it. The builder can also produce a photo message with a caption and `caption_entities`.
- **Signed requests.** A helper builds a `POST` request to `/webhook` with the test secret in the `X-Telegram-Bot-Api-Secret-Token` header and the update as JSON text in the body. Options leave the header out or change it, the method or the path.
- **Probe module.** A helper returns a module whose handlers record each call with its arguments, and which can be told to fail with a given error. It can register commands, button prefixes, message handlers, edited-message handlers, a job and a status function.
- **Gateway state.** A helper builds the state that `buildBot` takes. It calls `buildRegistry(modules)` for the registry and takes the database from `env`. The routing tests write their `Config` as a literal. Neither goes through `createGateway` or `readConfig`, so the routing tests depend on the registry and on nothing else.
- **Time.** Tests pass `now`, or insert a record with a chosen `claimed_at`.
- **Database failure.** A helper wraps `env.DB` in a proxy with two triggers. `failAll()` makes every later statement fail. `failWhen(predicate)` makes a statement fail when the predicate accepts its SQL text. A failing statement rejects when it is executed, through `first`, `run`, `all`, `raw` or `batch`, and not when it is prepared. The predicate gets the SQL text with every run of white space collapsed to one space and trimmed. Two texts are fixed for that purpose: the claim starts with `INSERT INTO updates`, and the database check in `/ping` is exactly `SELECT 1`. Failing everything from the start covers "settings cannot be read". Failing statements that start with `INSERT INTO updates` covers "update cannot be claimed". Calling `failAll()` from inside a test handler covers "outcome cannot be recorded" and "failure cannot be recorded". Failing the statement `SELECT 1` covers the database check in `/ping`.
- **Logging.** Tests spy on `console.log` and parse the lines.

**Test levels.** Most scenarios are tested through `fetch`. Four groups are not:

- The routing scenarios (Command routing, Button routing, Message routing, and "Job is not run") are tested on the built bot, by calling `buildBot(config, state)` and then `handleUpdate`. They assert which handlers ran and which calls were recorded. What the pipeline does with the result is tested through `fetch` in the update log tests.
- The Registration validation scenarios and "Job is recorded" are tested on `buildRegistry`.
- The two comparison scenarios of Webhook request verification are tested on `secretMatches`, because the gateway has no option for the compare function.
- "Record changed between the claim and the read" is tested on `resolveUnclaimed`. It describes a race between two statements, and no stored row produces it.

The test files that go through `fetch` have one test per scenario, named after it, except for these.

One test, in `test/webhook.test.ts`, calls `createGateway` with two modules that register the same command and expects `RegistrationError`. It shows that the gateway itself refuses to start, and not only `buildRegistry`.

**The pipeline is one task on purpose.** Task 2.7 turns five test files green in one checkbox. The ten steps of Decision 3 live in one file, and the task rules make work on one file one checkbox, so that two agents never edit it at once. The five files are separate so that a failure points at one area.

**The stub guard.** The check of the leading test section is skipped, so nobody is told when a test already passes. Every test written before the implementation therefore asserts at least one outcome that the stubs cannot produce:

- an exact status code other than 501,
- a row that is present,
- a recorded call to Telegram,
- a printed line,
- a returned value, for a pure function,
- a call that completes without an error, for `buildBot` and `handleUpdate`,
- or an error of a named class (`ConfigError`, `RegistrationError`) together with the value its message names.

A test whose scenario only expects something to be absent also asserts the response status. The stubs answer 501, throw a plain `Error` with the message `not implemented`, print nothing, and make `run` resolve to 1. The stub of `createGateway` does not throw and holds an empty registry. Every other stubbed function throws, including `buildRegistry` and `buildBot`.

Setup script tests run under Node with `node --test`, because the script is a Node program and the Workers runtime cannot run it (D31). They call the script's `run(argv, deps)` with a fake `fetch`, a fixed clock and captured output. Two scenarios cannot be reached that way, so they have tests of their own. "Secrets file with quotes and comments" is tested on `parseSecretsFile` as a pure function, because `run` gets the file already parsed. For "Exit status reaches the shell", one test starts `node scripts/setup.mjs` without a step as a child process and asserts the list of steps and a non-zero exit status.

### 12. Setup tooling (D19, D45, D46, D53, D56, D59, D60)

`scripts/setup.mjs` is a Node script with no dependencies. It exports `run(argv, deps)` and resolves to an exit code. When the file is executed directly, it calls `run(process.argv.slice(2), realDeps)`.

```ts
interface SetupDeps {
  env: Record<string, string | undefined>;                // process.env
  fetch: typeof fetch;
  print: (line: string) => void;                          // standard output
  printError: (line: string) => void;                     // standard error
  readSecretsFile: () => Record<string, string>;          // parsed .dev.vars, {} when absent
  randomBytes: (length: number) => Uint8Array;
  now: () => Date;
}
```

`argv` holds the arguments after the script name: the step first, then its arguments and flags.

| Step | Telegram calls | Output |
|---|---|---|
| `bot-info` | `getMe` | The identity as JSON for `BOT_INFO`. A warning when `can_read_all_group_messages` is false |
| `discover` | `getWebhookInfo`, `getUpdates` | Chats and senders seen in pending updates. Refuses while a webhook is registered, and when no update is pending (D56) |
| `secret` | none | A random 48-character secret (D30). Telegram allows 1 to 256 characters |
| `webhook <url>` | `setWebhook` | Confirmation. `--drop-pending` also discards pending updates (D29) |
| `webhook --delete` | `deleteWebhook` | Confirmation (D29) |
| `verify` | `getWebhookInfo` | Address, pending count, last error with its age. Non-zero exit on a problem (D53) |

Every call to Telegram is a `POST` with a JSON body.

**What each step prints (D60).** Results go to `print`, which is standard output. Warnings, problems and errors go to `printError`, which is standard error. The texts below are fixed. Words in angle brackets are filled in.

| Step | To `print` | To `printError` |
|---|---|---|
| `bot-info` | The `getMe` result as one line of JSON, and nothing else | `Privacy mode is on. Turn it off in BotFather with /setprivacy, then remove the bot from the group and add it again.` The step still prints the identity and exits with status 0 (D64) |
| `discover` | `Chats:` and one line per chat as `<id>  <type>  <title>`, then `Senders:` and one line per sender as `<id>  <first name>` | `A webhook is registered. Remove it with "webhook --delete" first.` or `No pending update found. Send a message in the group, check that privacy mode is off, and run discover again.` |
| `secret` | The secret, and nothing else | |
| `webhook <url>` | `Webhook registered: <url>`, and with `--drop-pending` also `Pending updates dropped.` | `WEBHOOK_SECRET is invalid: <reason>` or `The address must use HTTPS.` |
| `webhook --delete` | `Webhook removed.` | |
| `verify` | `Address: <url>`, `Pending updates: <n>`, and `Last error: none` or `Last error: <message> (<age> ago)` | One line per problem, as `Problem: <what is wrong>` |
| any | | `BOT_TOKEN is missing.`, `Telegram error: <description>`, `Request failed: <message>`, or `Steps: bot-info, discover, secret, webhook, verify` |

The reasons and problems are fixed texts too:

| Text | Filled in with |
|---|---|
| `WEBHOOK_SECRET is invalid: <reason>` | `it is empty`, `it is longer than 256 characters`, or `it has a character outside A-Z, a-z, 0-9, _ and -` |
| `Problem: <what is wrong>` | `no webhook is registered`, `the update types are <list>, expected message, edited_message, callback_query`, or `Telegram recorded a delivery error <age> ago: <message>` |
| `<age>` | whole minutes, rounded down, as `<n> min` (D64) |

`discover` reads the chat and the sender from every pending `message`, `edited_message` and button press, and lists each chat and each sender once. A private chat has no title, so it is listed with the first name (D56).

**`verify` and old errors (D53).** Telegram keeps the last delivery error until the webhook is set again, and the gateway's own 500 and 503 answers each record one. `verify` therefore treats an error as a problem only when it is 10 minutes old or less, measured with `deps.now()`. It prints an older error with its age and exits with status 0 when nothing else is wrong.

**The secrets file (D59).** `parseSecretsFile(text)` in `scripts/lib/secrets-file.mjs` turns the text of `.dev.vars` into a record. It reads lines of `KEY=value`, skips blank lines and lines that start with `#`, and removes one pair of single or double quotes around a value. The real `readSecretsFile` reads the file and calls it.

**Operator errors (D46).**

| Case | Behavior |
|---|---|
| No step, or an unknown step | Prints the list of steps, calls nothing, exits non-zero |
| A step needs the bot token and none is set | Prints that `BOT_TOKEN` is missing, calls nothing, exits non-zero |
| Both the environment and `.dev.vars` hold a value | The environment wins |
| The request fails before an answer arrives | Prints the error with the token removed, exits non-zero |
| Telegram answers with an error | Prints Telegram's description, exits non-zero |

The script never prints the token. Telegram's address contains the token, so the script replaces the token in any error text before printing.

**The script covers the Telegram side only (D19).** Creating the database, applying migrations, setting secrets, storing the allowed chat id and deploying are Wrangler commands, listed in `docs/setup.md`. *Alternative considered:* have the script run Wrangler too. It would then handle Cloudflare credentials and edit `wrangler.jsonc`, and none of that could be tested without an account.

**The setup guide (D45).** `docs/setup.md` has these second-level sections, in this order:

1. `Create the bot`
2. `Turn privacy mode off`
3. `Create the database`
4. `Set the secrets and settings`
5. `Store the allowed chat id`
6. `Deploy`
7. `Register and verify the webhook`
8. `Troubleshooting`

`scripts/guide.test.mjs` checks the guide under `node --test`. It asserts that the sections exist in this order, that every `npm run` script the guide names exists in `package.json`, and that every setup step it names is one of the script's steps. It does not check the wording. What the guide says about privacy mode and about anonymous posting is verified by review. The test is written together with the guide, not before it, so that the leading test section holds no test that depends on a document.

The fresh setup scenario needs a real bot and a real Cloudflare account. The operator validates it by hand after the first deploy.

`docs/setup.md` recommends `--drop-pending` for the first registration. The messages sent during discovery are still pending, and once expense capture exists they would otherwise be read as entries.

### 13. Module interfaces

The tests in section 1 of `tasks.md` are written before the implementation, so they need names to import. These are the exported names of each file. The stubs created in task 1.1 export exactly these, and section 2 fills them in. The types shown in Decisions 3, 5 and 9 are exported from the file that defines them: `GatewayOptions` from `index.ts`, `Decision`, `IgnoreReason` and `UpdateKind` from `classify.ts`, and the contract types from `registry.ts`.

```ts
// src/gateway/config.ts
interface Config {
  botToken: string;
  botInfo: UserFromGetMe;              // grammY's type for the getMe result
  memberIds: readonly number[];        // no duplicates
  timezone: string;
}
type SettingName = "BOT_TOKEN" | "BOT_INFO" | "ALLOWED_USER_IDS" | "HOUSEHOLD_TZ";
class ConfigError extends Error { readonly setting: SettingName; }
function readConfig(env: Env): Config;  // throws ConfigError

// src/gateway/secret.ts
type Compare = (a: Uint8Array, b: Uint8Array) => boolean;
function secretMatches(
  received: string | null,
  expected: string | undefined,
  compare?: Compare,                    // defaults to (a, b) => crypto.subtle.timingSafeEqual(a, b)
): boolean;

// src/gateway/classify.ts
function classifyUpdate(
  update: unknown,
  allowedChatId: number | null,
  memberIds: readonly number[],
): Decision;                            // never throws

// src/gateway/settings.ts
function getAllowedChatId(db: D1Database): Promise<number | null>;   // null when none, or not a whole number
function setAllowedChatId(db: D1Database, chatId: number, now: Date): Promise<void>;

// src/gateway/members.ts
interface Member { userId: number; displayName: string; }
function refreshMember(
  db: D1Database,
  sender: { userId: number; firstName: string; username?: string },
  now: Date,
): Promise<Member>;
function getMember(db: D1Database, userId: number): Promise<Member | null>;

// src/gateway/update-log.ts
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_SECONDS = 5;
interface ClaimInput {
  updateId: number;
  kind: UpdateKind;
  chatId: number;
  userId: number | null;
  raw: string;                          // the request body text as received
  now: Date;
}
type Unclaimed = "finished" | "in_progress" | "exhausted";
type ClaimResult =
  | { outcome: "claimed"; attempt: number }
  | { outcome: Unclaimed };
interface UpdateRecord { status: string; attempts: number; claimedAt: string; }
function resolveUnclaimed(record: UpdateRecord | null, now: Date): Unclaimed;   // pure
function claimUpdate(db: D1Database, input: ClaimInput): Promise<ClaimResult>;  // parks when exhausted
function finishUpdate(db: D1Database, updateId: number, now: Date): Promise<void>;
function failUpdate(db: D1Database, updateId: number, error: unknown, now: Date): Promise<"failed" | "parked">;
function getLastReceivedAt(db: D1Database, exceptUpdateId: number): Promise<string | null>;
function getParked(db: D1Database, limit: number): Promise<{ count: number; ids: number[] }>;
// getParked: count is the total. ids holds at most `limit`, most recently received first.

// src/gateway/registry.ts
class RegistrationError extends Error {}
interface Registry {
  commands: (CommandRegistration & { module: string })[];
  callbacks: (CallbackRegistration & { module: string })[];
  messages: { module: string; handle: UpdateHandler }[];
  editedMessages: { module: string; handle: UpdateHandler }[];
  jobs: (JobRegistration & { module: string })[];
  status: { module: string; report: (ctx: BotContext) => Promise<string[]> }[];
}
function buildRegistry(modules: FeatureModule[]): Registry;  // throws RegistrationError

// src/gateway/bot.ts
type GatewayState = BotContext["gateway"];
function buildBot(config: Config, state: GatewayState): Bot<BotContext>;   // one bot per admitted update

// src/gateway/index.ts
interface Gateway {
  registry: Registry;
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}
function createGateway(options: GatewayOptions): Gateway;    // throws RegistrationError

// src/core/index.ts
const core: FeatureModule;

// src/modules.ts
const modules: FeatureModule[];

// scripts/lib/secrets-file.mjs
function parseSecretsFile(text: string): Record<string, string>;   // pure

// scripts/setup.mjs
const STEPS: readonly string[];         // bot-info, discover, secret, webhook, verify
function run(argv: string[], deps: SetupDeps): Promise<number>;  // resolves to the exit code
```

The mapping from a `ClaimResult` to a response is the table in Decision 6: `finished` answers 200, `in_progress` answers 503 with `Retry-After: 5`, and `exhausted` answers 200.

## Risks / Trade-offs

- **Telegram's retry timing and per-chat blocking are observed, not documented** → The design depends only on documented rules: non-2xx is retried, 2xx is not, and `Retry-After` is honoured. Parking bounds how long one update can hold the group. The figures in Decision 6 rest on the observed timing and would change with it.
- **TypeScript 7.0.2 was not compiled against this toolchain during exploration** → `skipLibCheck` is on and `types` are explicit. The type check runs in the first task and in every task that writes TypeScript, and the stop rule in Decision 1 applies if it cannot pass.
- **No test profile exists for the ship run** → `.claude/testing/profile.json` is missing and cannot be discovered until the skeleton lands, so a ship run would skip its checks, and the check after section 2 of the tasks is the only gate for the tests of section 1. The commands are fixed by Decision 1: `npm test` and `npm run typecheck`. Writing the profile is the operator's step before the ship run, and it is not a task of this change, because the file belongs to the tooling and not to the project. How the run treats a profile whose command cannot run before task 1.1 has not been checked.
- **`bot.handleUpdate` is described by grammY as mainly for libraries and tests** → grammY is pinned exactly, and the tests exercise the call end to end.
- **Vitest's default file pattern was read from documentation, not run** → `test.include` is set explicitly, which is correct whatever the default is.
- **The 10 ms CPU limit with grammY loaded is unmeasured** → Handlers stay light. If the limit is hit, Telegram gets 503 and retries, and the attempt is counted. The paid plan is the fallback.
- **Two Cloudflare pages disagree on the free plan's query limit, and whether a batch counts once is undocumented** → The design budgets against the lower figure of 50 and counts every statement.
- **A member who posts anonymously is ignored with no notice** → The setup guide says so. The ignore is logged with its reason.
- **A database outage holds the group's messages in Telegram's queue** → That is intended. They are delivered when the database returns, within Telegram's 24 hours.
- **A failing update delays the group by about 10 seconds, and a killed one by up to about 6 minutes** → That is the cost of spacing the attempts and of the lease. After the third attempt the update is parked and the queue moves on.
- **A record can stay in `processing` for ever and is shown nowhere** → This happens when Telegram stops redelivering before the third attempt, as it does for a button press after about 150 seconds. It is an accepted risk (D51). The member sees no reaction and tries again.
- **A `done` write that fails leaves a record in `processing` for ever** → It is harmless, because the handlers succeeded and Telegram was answered 200. It is not shown in `/ping`.
- **`JobContext` and status lines are defined before anything uses them** → They are types and one optional field. If EB-09 needs a different shape, it changes them in its own change, which is no worse than adding them then.
- **Personal ids live in `wrangler.jsonc`** → Telegram user ids and the bot's identity are committed to the repository. They are not secrets, but the setup guide notes it for anyone who makes the repository public.
- **Old message ids stop working after a supergroup migration** → Telegram renumbers messages. This affects editing confirmations in place, which belongs to EB-05 and EB-06.
- **A job could send to the old chat id after a missed migration** → This belongs to EB-09 and EB-10, which send without an incoming update.

## Migration Plan

This is the first deployment, so there is nothing to migrate from. `docs/setup.md` gives the steps in full:

1. Create the bot in BotFather, turn privacy mode off, and add the bot to the group.
2. Run `bot-info` and `discover` to get `BOT_INFO`, the chat id and the user ids.
3. Create the D1 database, put its id in `wrangler.jsonc`, and apply migration `0001`.
4. Set `BOT_INFO`, `ALLOWED_USER_IDS` and `HOUSEHOLD_TZ` in `wrangler.jsonc`.
5. Run `secret`, then set the `BOT_TOKEN` and `WEBHOOK_SECRET` secrets.
6. Store the allowed chat id in the `settings` table.
7. Deploy, then run `webhook` and `verify`.
8. Send `/ping` in the group.

**Rollback.** Run `webhook --delete` to stop deliveries. Telegram keeps updates for 24 hours. Roll the Worker back with Wrangler. Migration `0001` only creates tables, so it needs no rollback.

## Open Questions

These can be answered later without changing the specs, the approach or the tasks.

- Should `/ping` also show the deployed version id, so a deploy is visible without a version bump?
- Should `/ping` count records left in `processing` past their lease?
- Should the command menu be registered with Telegram through `setMyCommands`?
- Should old records in the update log be pruned once the ledger holds the same raw text?
