/** One no-spending answer: the date, who pressed and when (design Decision 14). */
export interface NoSpendingMark {
  /** YYYY-MM-DD, household time. */
  date: string;
  byUserId: number;
  now: Date;
}

/** Records the date as a no-spending day. A date already recorded keeps its first record. */
export async function markNoSpending(db: D1Database, mark: NoSpendingMark): Promise<void> {
  await db
    .prepare("INSERT INTO day_marks (date, marked_by, marked_at) VALUES (?, ?, ?) ON CONFLICT (date) DO NOTHING")
    .bind(mark.date, mark.byUserId, mark.now.toISOString())
    .run();
}

/** Whether the date is recorded as a no-spending day. */
export async function isNoSpendingDay(db: D1Database, date: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM day_marks WHERE date = ?").bind(date).first();
  return row !== null;
}
