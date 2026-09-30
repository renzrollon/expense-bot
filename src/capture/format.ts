import { getCategory } from "../categories";
import type { Entry } from "../ledger";
import type { RejectionReason } from "../parser";
import { shiftDate } from "../parser/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEPARATOR = " · ";
const CHECK_AMOUNT = "⚠️ check amount";
/** A description longer than this many code points is cut (D53). */
const DESCRIPTION_MAX = 60;

/** `₱`, the pesos grouped by threes, and `.cc` only when the centavos are not zero. Integer arithmetic only. */
export function formatPesos(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const rest = centavos % 100;
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === 0 ? `₱${grouped}` : `₱${grouped}.${String(rest).padStart(2, "0")}`;
}

/** `today`, `yesterday`, or `<Mon> <d>` with `, <yyyy>` when the year differs from the send date's. */
export function dateLabel(spentOn: string, sentOn: string): string {
  if (spentOn === sentOn) return "today";
  if (spentOn === shiftDate(sentOn, -1)) return "yesterday";
  const [year, month, day] = spentOn.split("-");
  const label = `${MONTHS[Number(month) - 1]} ${Number(day)}`;
  return year === sentOn.slice(0, 4) ? label : `${label}, ${year}`;
}

/** `<emoji> <short name>`, or the id alone when it is not in the category list. */
export function categoryLabel(categoryId: string): string {
  const category = getCategory(categoryId);
  return category === undefined ? categoryId : `${category.emoji} ${category.shortName}`;
}

/** The description, cut to 59 code points and `…` when it is longer than 60 (D53). */
function shorten(description: string): string {
  const points = Array.from(description);
  return points.length > DESCRIPTION_MAX ? `${points.slice(0, DESCRIPTION_MAX - 1).join("")}…` : description;
}

function withCheck(parts: string[], entry: Entry): string {
  return (entry.checkAmount ? [...parts, CHECK_AMOUNT] : parts).join(SEPARATOR);
}

/** The confirmation of one message's stored entries, in plain text (design Decision 12). */
export function confirmationText(entries: readonly Entry[], payerName: string, sentOn: string): string {
  const first = entries[0];
  if (first === undefined) return "";
  const date = dateLabel(first.spentOn, sentOn);

  if (entries.length === 1) {
    return withCheck(
      [`✅ ${formatPesos(first.amountCentavos)}`, categoryLabel(first.categoryId), payerName, date],
      first,
    );
  }

  const total = entries.reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const header = [`✅ ${entries.length} entries`, formatPesos(total), payerName, date].join(SEPARATOR);
  const lines = entries.map((entry, i) => {
    const parts = [`${i + 1}. ${formatPesos(entry.amountCentavos)}`, categoryLabel(entry.categoryId)];
    if (entry.description !== "") parts.push(shorten(entry.description));
    return withCheck(parts, entry);
  });
  return [header, ...lines].join("\n");
}

/** The reply to a rejected message (design Decision 13). */
export function rejectionText(reason: RejectionReason): string {
  switch (reason) {
    case "multiple_dates":
      return "❌ Not logged: use one date per message.";
    case "invalid_date":
      return "❌ Not logged: that date does not exist.";
    case "future_date":
      return "❌ Not logged: the date is in the future.";
    case "amount_out_of_range":
      return "❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.";
    case "too_many_items":
      return "❌ Not logged: 10 items per message at most. Send the rest in another message.";
    default: {
      const unhandled: never = reason;
      throw new Error(`unhandled rejection reason: ${String(unhandled)}`);
    }
  }
}
