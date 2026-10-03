import type { BotContext, FeatureModule } from "../gateway/registry";
import type { Period } from "../ledger";
import { localDate } from "../parser/dates";
import { loadReport } from "./build";
import { formatReport } from "./format";
import { monthStart, rangeLabel, weekStart } from "./periods";

/** The `reports` module: /today, /week and /month (design Decision 11). */
export const reports: FeatureModule = {
  name: "reports",
  commands: [
    { name: "today", description: "spending today", handle: (ctx) => answer(ctx, "Today", (today) => today) },
    { name: "week", description: "spending this week", handle: (ctx) => answer(ctx, "This week", weekStart) },
    { name: "month", description: "spending this month", handle: (ctx) => answer(ctx, "This month", monthStart) },
  ],
};

/**
 * Replies to the command with the report from `start(today)` to today, where today
 * is the local date when the command is handled. The reply is still sent when the
 * command message was deleted. A database failure is not caught, so no reply is sent
 * and the gateway runs the command again.
 */
async function answer(ctx: BotContext, name: string, start: (today: string) => string): Promise<void> {
  const { db, now, timezone } = ctx.gateway;
  const today = localDate(now, timezone);
  const period: Period = { from: start(today), to: today };
  const text = formatReport(`${name} · ${rangeLabel(period)}`, await loadReport(db, period));
  const messageId = ctx.msg?.message_id;
  await ctx.reply(text, {
    ...(messageId === undefined ? {} : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } }),
    link_preview_options: { is_disabled: true },
  });
}
