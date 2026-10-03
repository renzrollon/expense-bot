import pkg from "../../package.json";
import type { BotContext, FeatureModule } from "../gateway/registry";
import { getLastReceivedAt, getParked } from "../gateway/update-log";

/** How many parked update ids /ping lists (D40). */
const PARKED_SHOWN = 5;

/**
 * The gateway's own module (Decision 10): /ping reports health, /help lists the
 * registered commands. Each sends one message, as a reply to the command (D48).
 */
export const core: FeatureModule = {
  name: "core",
  commands: [
    { name: "ping", description: "bot status", handle: ping },
    { name: "help", description: "this list", handle: help },
  ],
};

async function ping(ctx: BotContext): Promise<void> {
  const { db, timezone, registry } = ctx.gateway;

  // The database check. When it fails the handler throws and no reply is sent (D41).
  const started = Date.now();
  await db.prepare("SELECT 1").first();
  const elapsed = Math.round(Date.now() - started);

  const lastReceivedAt = await getLastReceivedAt(db, ctx.update.update_id);
  const parked = await getParked(db, PARKED_SHOWN);

  const lines = [
    `🏓 ${pkg.name} ${pkg.version}`,
    `Database: ok · ${elapsed} ms`,
    `Last update: ${lastReceivedAt === null ? "none yet" : formatTime(lastReceivedAt, timezone)}`,
    `Parked updates: ${parked.count === 0 ? "none" : `${parked.count} · ${parked.ids.join(", ")}`}`,
  ];

  // Module status lines, in registration order. A failing module shows one line (D52).
  for (const { module, report } of registry.status) {
    try {
      lines.push(...(await report(ctx)));
    } catch {
      console.log(JSON.stringify({ event: "status_failed", update_id: ctx.update.update_id, module }));
      lines.push(`${module}: status unavailable`);
    }
  }

  await replyTo(ctx, lines.join("\n"));
}

async function help(ctx: BotContext): Promise<void> {
  const lines = ["Commands", ...ctx.gateway.registry.commands.map((c) => `/${c.name} · ${c.description}`)];
  await replyTo(ctx, lines.join("\n"));
}

/** One message, sent as a reply to the command message, still sent when that message was deleted. */
async function replyTo(ctx: BotContext, text: string): Promise<void> {
  const messageId = ctx.msg?.message_id;
  await ctx.reply(
    text,
    messageId === undefined ? {} : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } },
  );
}

/** Short month, day without a leading zero, 24-hour time with two-digit hour and minute. */
function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
