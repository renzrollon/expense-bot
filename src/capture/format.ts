import { getCategory } from "../categories";
import type { RejectionReason } from "../parser";
import { shiftDate } from "../parser/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
export function shorten(description: string): string {
  const points = Array.from(description);
  return points.length > DESCRIPTION_MAX ? `${points.slice(0, DESCRIPTION_MAX - 1).join("")}…` : description;
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
