import { NOT_COUNTED_IDS } from "../categories";
import {
  MONTHLY_RECAP,
  MONTHLY_RECAP_CATCH_UP_HOURS,
  WEEKLY_DIGEST,
  WEEKLY_DIGEST_CATCH_UP_HOURS,
} from "../config/schedule";
import type { FeatureModule, JobContext } from "../gateway/registry";
import { countDaysWithEntries, largestEntries, type Period } from "../ledger";
import { shiftDate } from "../parser/dates";
import { loadReport } from "../reports/build";
import { monthStart, previousMonth } from "../reports/periods";
import { sendOnce } from "../scheduler/sends";
import { monthlyRecapText, weeklyDigestText } from "./format";

const TOP_ENTRIES = 5;

/** Sends `text` to the group in plain text, with link previews turned off. */
function sendText(job: JobContext, text: string) {
  return job.api.sendMessage(job.chatId, text, { link_preview_options: { is_disabled: true } });
}

/**
 * `weekly_digest`: the 7 days that end on the scheduled Sunday, then the month to date
 * (design Decision 13). Every date comes from `job.scheduledDate`.
 */
async function weeklyDigest(job: JobContext): Promise<void> {
  const date = job.scheduledDate;
  await sendOnce(job.db, { job: "weekly_digest", scheduledDate: date, part: "digest" }, job.now, async () => {
    const week: Period = { from: shiftDate(date, -6), to: date };
    const report = await loadReport(job.db, week);
    const monthToDate = await loadReport(job.db, { from: monthStart(date), to: date });
    return sendText(job, weeklyDigestText(week, report, monthToDate.totalCentavos));
  });
}

/**
 * `monthly_recap`: the calendar month before the scheduled date, its largest counted
 * entries and its days with entries (design Decision 13). Every date comes from `job.scheduledDate`.
 */
async function monthlyRecap(job: JobContext): Promise<void> {
  const date = job.scheduledDate;
  await sendOnce(job.db, { job: "monthly_recap", scheduledDate: date, part: "recap" }, job.now, async () => {
    const month = previousMonth(date);
    const report = await loadReport(job.db, month);
    const top = await largestEntries(job.db, month, { limit: TOP_ENTRIES, excludeCategoryIds: NOT_COUNTED_IDS });
    const days = await countDaysWithEntries(job.db, month);
    return sendText(job, monthlyRecapText(month, report, top, days));
  });
}

/** The `digests` module: weekly_digest and monthly_recap (design Decision 13). */
export const digests: FeatureModule = {
  name: "digests",
  jobs: [
    { name: "weekly_digest", schedule: WEEKLY_DIGEST, catchUpHours: WEEKLY_DIGEST_CATCH_UP_HOURS, run: weeklyDigest },
    { name: "monthly_recap", schedule: MONTHLY_RECAP, catchUpHours: MONTHLY_RECAP_CATCH_UP_HOURS, run: monthlyRecap },
  ],
};
