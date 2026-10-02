# expense-bot

A Telegram bot for household expenses, running as a Cloudflare Worker with a D1 database. The bot gateway receives Telegram updates, admits only the household group and its members, processes each update at most once, and routes it to the feature modules listed in `src/modules.ts`.

## Setup

Follow the [setup guide](docs/setup.md) to create the bot, the database and the webhook.

## Commands

- `/ping`: the bot's name and version, the database check, and each job's last run.
- `/help`: lists the commands.
- `/today`, `/week`, `/month`: a report of the household's spending for the period.
- `/undo`: removes your last entry.
- `/export`: sends the entries as a CSV file, for one month (`/export 2026-09`) or `all`.

## Scheduled jobs

The hourly cron trigger runs four jobs:

- `weekly_digest`: Sunday at 19:00.
- `monthly_recap`: the 1st of the month at 08:00.
- `evening_nudge`: every evening, at 21:00 unless `NUDGE_HOUR` says otherwise. `NUDGE_ENABLED=false` turns it off.
- `nightly_backup`: every day at 23:00, sends CSV backup files to the household group or to `BACKUP_CHAT_ID`.

Hours are household time. See [Backup and restore](docs/backup-restore.md) for the backup files and how to restore them.

## Tests

```sh
npm test
```

This one command runs every test: the Vitest suite inside the Workers runtime, then the setup script tests under `node --test`.

Type checking is separate:

```sh
npm run typecheck
```
