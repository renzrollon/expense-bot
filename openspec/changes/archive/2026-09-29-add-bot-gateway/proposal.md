## Why

Every feature of the expense bot needs a Worker that receives Telegram updates safely, processes each one once, and listens only to the household. Nothing exists yet, so this change also lays the project skeleton in a shape that lets later issues (EB-02 to EB-13) be built in parallel by adding a module and one registration line.

## What Changes

- **Project skeleton.** TypeScript in strict mode, Wrangler, grammY, Vitest running inside the Workers runtime, a D1 binding and a migrations folder. One command runs all tests.
- **Departures from the epic.** Each is explained in `design.md` under the decision named.
  - The gateway does not use grammY's `cloudflare-mod` adapter. It answers the webhook itself and hands each update to grammY, so that it controls the status code (D3).
  - The Vitest package is `@cloudflare/vitest-plugin`, the renamed successor of the package the epic calls "the Workers pool" (D2).
  - Later issues share four files, not three. The Worker entry is the fourth, so that EB-09 can add its cron handler (D33).
  - `/ping` cannot report a database that is unreachable, because the gateway needs the database before any handler runs. A reply to `/ping` is itself the proof that the database answers.
- **Additions to the epic.** A failed attempt asks Telegram to wait 5 seconds before it retries (D35). A module can add status lines to `/ping` (D34).
- **Webhook endpoint.** It checks Telegram's secret header before it reads or stores anything. A request without the correct secret is rejected.
- **Allowlist.** The bot listens to one group chat and its members. Everything else is acknowledged and ignored, with no reply and nothing stored.
- **Update log.** Each accepted update is stored raw and processed at most once. A failed update is retried when Telegram redelivers it. After 3 failed attempts it is parked, so it stops blocking later messages.
- **Member records.** Each member's Telegram user id maps to a display name, refreshed from every accepted update.
- **Supergroup follow.** When the group is upgraded to a supergroup, the bot follows the new chat id without a redeploy.
- **Module registration.** Each feature module registers its commands, button prefixes, message handlers, jobs and status lines. Conflicting registrations stop the bot from starting.
- **Commands.** `/ping` reports the version, database reachability, the last update time and parked updates, followed by any status lines that modules registered. `/help` is generated from the registered commands.
- **Setup guide and script.** They cover BotFather, privacy mode, the webhook, secrets and settings.

### Non-goals

- Expense parsing, storage, categories and reports (EB-02 to EB-08).
- Running scheduled jobs. This change records job registrations but does not run them (EB-09).
- Any LLM call (EB-13).
- Pruning stored updates, and registering the command menu with Telegram.

## Capabilities

### New Capabilities

- `bot-gateway`: receiving and verifying Telegram webhook requests, the chat and member allowlist, the update log with retry and parking, member records, supergroup follow, feature module registration, the `/ping` and `/help` commands, and the setup tooling.

### Modified Capabilities

None. This is the first capability in the project.

## Impact

- **Code.** New project at the repository root: Worker source, tests, migrations, a setup script and a setup guide. No existing code is affected.
- **Database.** Migration `0001` creates the `updates`, `members` and `settings` tables.
- **Dependencies, pinned exactly.** `grammy` 1.46.0, `wrangler` 4.143.0, `@cloudflare/vitest-plugin` 1.3.1, `vitest` 4.1.11, `typescript` 7.0.2, `@types/node` 24.19.0.
- **External systems.** A Telegram bot created in BotFather, and a Cloudflare account with one Worker and one D1 database on the free plan.
- **Configuration.** Secrets `BOT_TOKEN` and `WEBHOOK_SECRET`. Settings `BOT_INFO`, `ALLOWED_USER_IDS` and `HOUSEHOLD_TZ`. The allowed chat id lives in the database.
- **Later issues.** EB-02, EB-03, EB-04 and EB-09 build directly on this change. They depend on the registration contract and on the rule that a handler may run again for the same update after a failed attempt.
