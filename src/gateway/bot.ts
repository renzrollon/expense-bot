import { Bot } from "grammy";
import type { Config } from "./config";
import type { BotContext } from "./registry";

export type GatewayState = BotContext["gateway"];

/** The notice for a button press that no registered prefix takes (D26). */
export const STALE_BUTTON_NOTICE = "This button no longer works.";

/**
 * Builds the grammY bot for one admitted update (Decision 3, D50). The update's
 * state is captured by closure, so nothing about it is shared with another request.
 * Handlers are installed in the routing order of Decision 9, and every handler for
 * an update runs one after another in registration order (D27).
 */
export function buildBot(config: Config, state: GatewayState): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.botToken, {
    // Known identity, so grammY never calls getMe.
    botInfo: config.botInfo,
    // Look up the global fetch at call time, so tests can replace it.
    client: { fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch },
  });
  const { registry } = state;

  // 1. Attach the gateway state.
  bot.use(async (ctx, next) => {
    ctx.gateway = state;
    await next();
  });

  // 2. Registered commands. grammY matches the name exactly, accepts @ThisBot in any
  // case, and applies only to new messages. The gateway trims the arguments at both ends.
  for (const command of registry.commands) {
    bot.command(command.name, async (ctx) => {
      await command.handle(ctx, (typeof ctx.match === "string" ? ctx.match : "").trim());
    });
  }

  // 3. Any other new text message that starts with a command stops here (D28).
  bot.filter(startsWithCommand, async () => {});

  // 4. Button presses: prefix and payload split at the first colon.
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const colon = data === undefined ? -1 : data.indexOf(":");
    const registration =
      data !== undefined && colon > 0
        ? registry.callbacks.find((callback) => callback.prefix === data.slice(0, colon))
        : undefined;
    if (data === undefined || registration === undefined) {
      await ctx.answerCallbackQuery({ text: STALE_BUTTON_NOTICE });
      return;
    }
    await registration.handle(ctx, data.slice(colon + 1));
  });

  // 5. New messages: every message handler, in registration order.
  bot.on("message", async (ctx) => {
    for (const { handle } of registry.messages) await handle(ctx);
  });

  // 6. Edited messages: every edited-message handler, in registration order.
  bot.on("edited_message", async (ctx) => {
    for (const { handle } of registry.editedMessages) await handle(ctx);
  });

  return bot;
}

/** A new text message whose entities hold a bot_command at offset 0. */
function startsWithCommand(ctx: BotContext): boolean {
  const message = ctx.message;
  if (message === undefined || typeof message.text !== "string") return false;
  return (message.entities ?? []).some((entity) => entity.type === "bot_command" && entity.offset === 0);
}
