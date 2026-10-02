import { STALE_BUTTON_NOTICE } from "../gateway/bot";
import type { BotContext, FeatureModule, JobContext, JobRegistration } from "../gateway/registry";
import { countActiveEntriesOn } from "../ledger";
import { isRealDate } from "../parser/dates";
import { shortDate } from "../reports/periods";
import { sendOnce } from "../scheduler/sends";
import { answerPress, editInPlace } from "../telegram/inplace";
import type { NudgeSettings } from "./settings";
import { isNoSpendingDay, markNoSpending } from "./store";

const PREFIX = "n";
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The date a press names, when it is a real calendar date written `YYYY-MM-DD`; otherwise null. */
function pressedDate(payload: string): string | null {
  const match = DATE.exec(payload);
  if (match === null) return null;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3])) ? payload : null;
}

/**
 * `evening_nudge`: one message for the scheduled date, through the send record, unless
 * the date has an active entry or is a no-spending day (design Decision 14). The text
 * names the scheduled date, so a late run after midnight still reads correctly.
 */
async function eveningNudge(job: JobContext): Promise<void> {
  const date = job.scheduledDate;
  await sendOnce(job.db, { job: "evening_nudge", scheduledDate: date, part: "nudge" }, job.now, async () => {
    if ((await countActiveEntriesOn(job.db, date)) > 0) return null;
    if (await isNoSpendingDay(job.db, date)) return null;
    return job.api.sendMessage(
      job.chatId,
      `🌙 Nothing logged for ${shortDate(date)} yet. Send an expense, or tap below if there was none.`,
      {
        reply_markup: { inline_keyboard: [[{ text: "No spending today", callback_data: `${PREFIX}:${date}` }]] },
        link_preview_options: { is_disabled: true },
      },
    );
  });
}

/**
 * The `n:<date>` press: records the no-spending day unless the date has entries now,
 * edits the nudge in place and answers last (design Decisions 7 and 14).
 */
async function pressNoSpending(ctx: BotContext, payload: string): Promise<void> {
  const date = pressedDate(payload);
  if (date === null) {
    await answerPress(ctx, STALE_BUTTON_NOTICE);
    return;
  }
  const { db, now, member } = ctx.gateway;
  let text: string;
  let notice: string;
  if ((await countActiveEntriesOn(db, date)) > 0) {
    text = `👍 ${shortDate(date)} has entries now.`;
    notice = "Entries were logged for that day.";
  } else {
    await markNoSpending(db, { date, byUserId: member.userId, now });
    text = `✅ No spending on ${shortDate(date)}.`;
    notice = "Noted.";
  }
  const message = ctx.callbackQuery?.message;
  if (message !== undefined) {
    await editInPlace(
      ctx.api,
      { chatId: message.chat.id, messageId: message.message_id },
      { text, keyboard: [] },
      ctx.update.update_id,
    );
  }
  await answerPress(ctx, notice);
}

/**
 * The `nudge` module (design Decision 14): the `evening_nudge` job when the nudge is
 * enabled, and the `n` press either way, so an earlier nudge can still be answered.
 */
export function createNudge(settings: NudgeSettings): FeatureModule {
  const jobs: JobRegistration[] = settings.enabled
    ? [{ name: "evening_nudge", schedule: { every: "day", hour: settings.hour }, run: eveningNudge }]
    : [];
  return {
    name: "nudge",
    callbacks: [{ prefix: PREFIX, handle: pressNoSpending }],
    jobs,
  };
}
