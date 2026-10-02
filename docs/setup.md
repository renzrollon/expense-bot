# Setup guide

This guide takes a new Telegram bot and an empty Cloudflare account to a household group where `/ping` gets an answer. Follow the sections in order.

You need Node.js 24 or later, npm, a Telegram account, and a Cloudflare account. Install the dependencies once:

```sh
npm install
```

The setup script covers the Telegram side. It reads `BOT_TOKEN` and `WEBHOOK_SECRET` from the environment or from `.dev.vars`, and a value in the environment wins. Create `.dev.vars` from the example and never commit it:

```sh
cp .dev.vars.example .dev.vars
```

Run a step with `npm run setup -- <step>`. The steps are `bot-info`, `discover`, `secret`, `webhook` and `verify`. Running `npm run setup` without a step prints this list.

## Create the bot

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Choose a display name and a username that ends in `bot`.
3. BotFather replies with a token. Put it in `.dev.vars` as `BOT_TOKEN=<token>`. Treat it like a password.
4. Read the bot's identity:

   ```sh
   npm run setup -- bot-info
   ```

   The step prints one line of JSON. Keep it: it becomes the `BOT_INFO` setting in [Set the secrets and settings](#set-the-secrets-and-settings).

## Turn privacy mode off

The bot must read every message in the group, not only commands.

1. In BotFather, send `/setprivacy`, choose the bot, and choose `Disable`.
2. Add the bot to the household group. If it is already in the group, remove it and add it again. Telegram applies the privacy setting only when the bot joins.
3. Run `npm run setup -- bot-info` again. While privacy mode is still on, the step prints a warning after the identity. Use the JSON from this run, which now shows `"can_read_all_group_messages":true`.

Then find the ids the bot needs. Send a message in the group from each member's account, then run:

```sh
npm run setup -- discover
```

The step lists each chat as `<id>  <type>  <title>` and each sender as `<id>  <first name>`. Note the group's chat id and each member's user id. A supergroup's id starts with `-100`.

`discover` works only while no webhook is registered. If it says a webhook is registered, run `npm run setup -- webhook --delete` first. If it finds no pending update, send another message in the group and check that privacy mode is off.

## Create the database

1. Log in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Create the database:

   ```sh
   npx wrangler d1 create expense-bot
   ```

3. Copy the `database_id` it prints into `wrangler.jsonc`, in place of the placeholder `00000000-0000-0000-0000-000000000000`.
4. Apply the migrations to the remote database:

   ```sh
   npm run db:migrate:remote
   ```

   For local runs with `npm run dev`, also apply them locally with `npm run db:migrate:local`.

## Set the secrets and settings

1. Set the three settings under `vars` in `wrangler.jsonc`:

   | Setting | Value |
   |---|---|
   | `BOT_INFO` | The JSON line from `bot-info`, written as a JSON string |
   | `ALLOWED_USER_IDS` | The members' user ids from `discover`, as a JSON list such as `"[1001, 1002]"` |
   | `HOUSEHOLD_TZ` | The household's timezone name, such as `Asia/Manila` |

   These values are committed with the repository. User ids and the bot's identity are not secrets, but anyone who can read the repository sees them. Keep that in mind before you make the repository public.

2. Generate the webhook secret:

   ```sh
   npm run setup -- secret
   ```

   Put the printed value in `.dev.vars` as `WEBHOOK_SECRET=<secret>`.

3. Store both secrets in Cloudflare. Each command asks for the value:

   ```sh
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET
   ```

When a setting is missing or invalid, the Worker answers every update with status 500 and logs `config_invalid` with the name of the setting. It processes nothing until the setting is fixed and the Worker is deployed again.

## Store the allowed chat id

The bot answers in one group only. Store that group's chat id from `discover` in the `settings` table, replacing `<chat id>`:

```sh
npx wrangler d1 execute expense-bot --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', '<chat id>', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
```

Until this row exists, the bot ignores every update. When Telegram upgrades the group to a supergroup, the bot follows it and updates this row itself.

## Deploy

```sh
npm run deploy
```

Wrangler prints the Worker's address, such as `https://expense-bot.<your-subdomain>.workers.dev`. The webhook address is that address followed by `/webhook`.

Deploying also registers the hourly cron trigger that runs scheduled jobs. If a deploy adds a database migration, run `npm run db:migrate:remote` before `npm run deploy`. After a deploy, `/ping` shows each job's last run.

## Register and verify the webhook

1. Register the webhook. For the first registration, add `--drop-pending`:

   ```sh
   npm run setup -- webhook https://expense-bot.<your-subdomain>.workers.dev/webhook --drop-pending
   ```

   `--drop-pending` discards the messages sent during `discover`, which are still waiting in Telegram. Once expense capture exists, they would otherwise be read as entries. The address must use HTTPS.

2. Check the webhook:

   ```sh
   npm run setup -- verify
   ```

   It prints the address, the number of pending updates, and the last delivery error. It exits with a non-zero status when no webhook is registered, when the update types are not `message`, `edited_message` and `callback_query`, or when Telegram recorded a delivery error in the last 10 minutes.

3. Send `/ping` in the group. The bot replies with its name and version, the database check, the time of the last update and the parked updates.

## Troubleshooting

**The bot answers commands and reacts to nothing else.** Privacy mode is on, so Telegram delivers only commands to the bot. In BotFather, send `/setprivacy`, choose the bot and choose `Disable`. Then remove the bot from the group and add it again, because Telegram applies the setting only when the bot joins. `npm run setup -- bot-info` warns while privacy mode is on.

**A member's messages are ignored.** The bot processes messages only from user ids in `ALLOWED_USER_IDS`. A member who posts anonymously as a group administrator, or on behalf of a channel, is ignored: Telegram does not include the real sender's id in the update, so the bot cannot tell who wrote the message. Ask members to post as themselves.

**The bot does not answer at all.** Run `npm run setup -- verify` and read the problems it prints. Then check that the allowed chat id is stored, as in [Store the allowed chat id](#store-the-allowed-chat-id). The Worker's logs in the Cloudflare dashboard name the reason for each ignored update (`update_ignored`) and any invalid setting (`config_invalid`).

**`verify` reports an old delivery error.** Telegram keeps the last error until the webhook is registered again. An error more than 10 minutes old is printed with its age and is not a problem.

**`/ping` shows parked updates.** An update is parked after its third failed attempt, so that it stops holding back the group's later messages. The Worker's logs hold `attempt_failed` entries for it.

**You need to run `discover` again.** Remove the webhook with `npm run setup -- webhook --delete`, send a message in the group, run `discover`, and register the webhook again.
