import { categoryLabel, formatPesos, shorten } from "../capture/format";
import type { Entry, Period } from "../ledger";
import type { Report } from "../reports/build";
import { formatReport } from "../reports/format";
import { daysInMonth, monthTitle, rangeLabel, shortDate } from "../reports/periods";

/**
 * The weekly digest (design Decision 13): the week's report under `Weekly digest · <range>`,
 * then `Month to date: <amount>`. A week with no active entry is one line. Pure.
 */
export function weeklyDigestText(week: Period, report: Report, monthToDateCentavos: number): string {
  const range = rangeLabel(week);
  if (report.empty) return `🌱 Nothing logged for ${range}. A fresh week starts tomorrow.`;
  return `${formatReport(`Weekly digest · ${range}`, report)}\n\nMonth to date: ${formatPesos(monthToDateCentavos)}`;
}

/**
 * The monthly recap (design Decision 13): the month's report under `<month name> <year>`,
 * the top entries when there are any, the daily average and the days with entries.
 * `top` is already the largest counted entries in order; a month with no active entry is one line. Pure.
 */
export function monthlyRecapText(
  month: Period,
  report: Report,
  top: readonly Entry[],
  daysWithEntries: number,
): string {
  const title = monthTitle(month.from);
  if (report.empty) return `🌱 Nothing logged in ${title}.`;
  const days = daysInMonth(month.from);
  const out = [formatReport(title, report)];
  if (top.length > 0) {
    out.push("", "Top entries");
    top.forEach((entry, index) => {
      const parts = [`${index + 1}. ${formatPesos(entry.amountCentavos)}`, categoryLabel(entry.categoryId)];
      if (entry.description !== "") parts.push(shorten(entry.description));
      parts.push(shortDate(entry.spentOn));
      out.push(parts.join(" · "));
    });
  }
  // Whole pesos, a half rounded up: floor((2 * total + 100 * days) / (200 * days)).
  const averagePesos = Math.floor((2 * report.totalCentavos + 100 * days) / (200 * days));
  out.push("", `Daily average: ${formatPesos(averagePesos * 100)}`, `Days with entries: ${daysWithEntries} of ${days}`);
  return out.join("\n");
}
