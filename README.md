# expense-bot

A Telegram bot for household expenses, running as a Cloudflare Worker with a D1 database. The bot gateway receives Telegram updates, admits only the household group and its members, processes each update at most once, and routes it to the feature modules listed in `src/modules.ts`.

## Setup

Follow the [setup guide](docs/setup.md) to create the bot, the database and the webhook.

## Tests

```sh
npm test
```

This one command runs every test: the Vitest suite inside the Workers runtime, then the setup script tests under `node --test`.

Type checking is separate:

```sh
npm run typecheck
```
