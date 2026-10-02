import { countsAsSpending } from "../categories";
import { totalsByCategory, type CategoryTotal, type Period } from "../ledger";

/** A period's household totals (design Decision 11). Whole centavos; shares are whole percentages. */
export interface Report {
  totalCentavos: number;
  count: number;
  lines: { categoryId: string; totalCentavos: number; share: number }[];
  notCounted: { categoryId: string; totalCentavos: number }[];
  empty: boolean; // no active entry at all
}

/** Splits the rows by `countsAsSpending`, keeping the order given (total, then id). Pure. */
export function buildReport(totals: readonly CategoryTotal[]): Report {
  const spending = totals.filter((row) => countsAsSpending(row.categoryId));
  const totalCentavos = spending.reduce((sum, row) => sum + row.totalCentavos, 0);
  const count = spending.reduce((sum, row) => sum + row.count, 0);
  return {
    totalCentavos,
    count,
    // Half rounded up in integer arithmetic: floor((200 * part + total) / (2 * total)).
    lines: spending.map((row) => ({
      categoryId: row.categoryId,
      totalCentavos: row.totalCentavos,
      share: Math.floor((200 * row.totalCentavos + totalCentavos) / (2 * totalCentavos)),
    })),
    notCounted: totals
      .filter((row) => !countsAsSpending(row.categoryId))
      .map((row) => ({ categoryId: row.categoryId, totalCentavos: row.totalCentavos })),
    empty: totals.length === 0,
  };
}

/** One `totalsByCategory` call. Throws `RangeError` for a malformed period; a database failure is not caught. */
export async function loadReport(db: D1Database, period: Period): Promise<Report> {
  return buildReport(await totalsByCategory(db, period));
}
