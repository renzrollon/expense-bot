# expense-bot

A Telegram bot that keeps a household's expense ledger. Members type what they spent in the household group, and the bot logs it, files it under a category, and reports totals. It runs as a Cloudflare Worker with a D1 database and one hourly cron trigger.

## Status

The code is complete for first use and its tests pass, but the bot is not deployed yet. [Telegram readiness](docs/telegram-readiness.md) lists the setup steps still needed, in order, and the defects found in the last review, with a note on the ones fixed since.

## Using the bot

### Log an expense

Send a message with a description and an amount. The sender is the payer.

| Message | Result |
|---|---|
| `lunch 250` | ₱250, dated today |
| `grab 1.5k` | ₱1,500 |
| `₱80 coffee` | ₱80 |
| `grab 180, groceries 2340` | Two entries. Items are separated by a new line, `,`, `;`, `and` or `+`, up to 10 per message |
| `kahapon lunch 250` | Dated yesterday. Also `yesterday`, `kagabi`, `3 days ago`, `sep 27`, `sep 27, 2026`, `2026-09-27`. For May and January write the day first, as in `2 may`: `may` and `jan` before a number are read as Tagalog words |
| `dinner for 2 600` | ₱600, marked `⚠️ check amount` because the message holds two numbers |
| `grab 180 (2 rides)` | ₱180, marked `⚠️ check amount`. Of several numbers without `₱`, the bot takes one written as money (`1,500`, `180.50`, `1.5k`), else the largest |

The bot replies with a confirmation such as `✅ ₱250 · 🍽 Dining · Ana · today`. A message it cannot log gets a reply starting `❌ Not logged:` with the reason: two dates, a date that does not exist, a future date, an amount outside ₱0 to ₱10,000,000, or more than 10 items. Photos, voice notes and stickers are ignored.

**Keep the group mostly for expenses.** The bot reads every message. It leaves out forwarded messages, times such as `see you at 7`, codes such as `OTP: 123456`, phone and card numbers, and `+1`. Other chat that holds a bare number can still be logged: `bring 2 chairs` becomes ₱2. Undo anything it logs by mistake.

### Correct an entry

Each entry in a confirmation has two buttons, and either member can use them on any entry:

- `Category` opens the list of 14 categories. Picking one refiles the entry. When the description has 1 to 3 words, the bot also learns it as a keyword, so `acai` goes to the same category from then on.
- `Undo` removes the entry and offers `Restore`.

A button works only on the confirmation of its own entry. Any other press is answered with `This button no longer works.`

Editing a message you already sent does not change its entry. The confirmation gains `✏️ Edit not applied. Undo and resend.`

Transfers are a category that is not counted as spending. Reports list them on a separate `Not counted` line.

### Commands

- `/today`, `/week`, `/month`: the household's spending today, from Monday to today, or from the 1st to today, with a line per category.
- `/undo`: removes your most recent entry.
- `/export`: sends the active entries as a CSV file. `/export` covers the current month, `/export 2026-09` one month, and `/export all` everything, up to 1,500 entries in one file.
- `/ping`: the version, the database check, the time of the last update, the parked updates, and each job's last run.
- `/help`: lists the commands.

### Scheduled messages

The hourly cron trigger runs four jobs. Hours are household time (`HOUSEHOLD_TZ`).

| Job | When | What it sends |
|---|---|---|
| `weekly_digest` | Sunday 19:00 | The week from Monday to Sunday, and the month so far |
| `monthly_recap` | The 1st at 08:00 | The previous month, with its largest entries and daily average |
| `evening_nudge` | Daily at `NUDGE_HOUR` | A reminder, only when nothing is logged for the day. Its `No spending today` button stops it for that day |
| `nightly_backup` | Daily at 23:00 | Two CSV backup files, sent silently. In the first nights of each month, also one part of a snapshot of the whole ledger |

A run that fails or is missed is tried again each hour while it is due, then skipped: for 24 hours for the weekly digest, 48 hours for the monthly recap, 2 hours for the nudge and 3 hours for the backup. Each message is sent at most once for its date. When the nightly backup has still not finished after its 3 hours, or was skipped after it had run before, the bot tells the group once, without a sound. `/ping` shows each job's last run, with the reason when it failed.

## Who can use it

The bot answers in one group only, and only to the user ids in `ALLOWED_USER_IDS`. It ignores other chats, other users, anonymous group administrators and channel posts without replying.

## Settings

Secrets are stored in Cloudflare. The other settings are `vars` in `wrangler.jsonc`.

| Setting | Kind | Required | Value |
|---|---|---|---|
| `BOT_TOKEN` | Secret | Yes | The token from BotFather |
| `WEBHOOK_SECRET` | Secret | Yes | From `npm run setup -- secret` |
| `BOT_INFO` | Var | Yes | The bot's identity as a JSON string, from `npm run setup -- bot-info --escaped` |
| `ALLOWED_USER_IDS` | Var | Yes | The members' user ids as a JSON list, such as `"[1001, 1002]"` |
| `HOUSEHOLD_TZ` | Var | Yes | A timezone name, such as `Asia/Manila` |
| `NUDGE_ENABLED` | Var | No | `"true"` or `"false"`. Default `true` |
| `NUDGE_HOUR` | Var | No | `"0"` to `"23"`. Default `21` |
| `BACKUP_CHAT_ID` | Var | No | The chat id that receives the backup files, such as `"1001"`. Default: the household group |

The group's chat id is not a var. It is the `allowed_chat_id` row of the `settings` table, and the bot updates it when Telegram upgrades the group to a supergroup.

## Setup

1. [Telegram readiness](docs/telegram-readiness.md#setup-still-needed): the checklist from this repository to a bot that answers in the group.
2. [Setup guide](docs/setup.md): each step in more detail, and troubleshooting.
3. [Backup and restore](docs/backup-restore.md): the nightly backup files and how to restore from them.

## Development

You need Node.js 24 or later.

```sh
npm ci
npm test
npm run typecheck
```

`npm test` runs the Vitest suite inside the Workers runtime, then the script tests under `node --test`. Run one file with `npx vitest run <file>`, or `node --test <file>` for a script test. `npm run typecheck` regenerates `worker-configuration.d.ts` and checks `src` and `test`.

To run the Worker locally:

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Use the token of a separate test bot in `.dev.vars`. With the production token and the real group's chat id in the local database, local runs post to the household group.

### Layout

| Path | Contents |
|---|---|
| `src/index.ts` | Entry point: requests go to the gateway, the cron trigger to the scheduler |
| `src/modules.ts` | The feature modules in registration order. Capture stays last |
| `src/gateway/` | Webhook secret check, settings, allowlist, once-only update log, command and button routing |
| `src/core/` | `/ping` and `/help` |
| `src/parser/`, `src/capture/` | Reading a message as expenses, storing them, and the confirmation |
| `src/categories/` | Categories, built-in keywords and learned keywords |
| `src/ledger/` | The `expenses` table |
| `src/corrections/` | The buttons, `/undo` and edited messages |
| `src/reports/`, `src/digests/`, `src/nudge/` | Reports, the weekly and monthly messages, the evening nudge |
| `src/export/` | `/export` and the nightly backup |
| `src/telegram/` | Editing bot messages, answering presses, and the client options every Telegram call uses: a 20-second timeout and the wait for a short rate limit |
| `src/scheduler/`, `src/config/schedule.ts` | The hourly tick, run records and job times |
| `migrations/` | The D1 schema |
| `scripts/` | `setup.mjs` for the Telegram side of setup, `restore.mjs` for backups |
| `test/` | Tests in the Workers runtime; pure tests under `test/unit/` |
| `openspec/` | Specs and change proposals |
