import type { LearnedKeyword, LearnedSource } from "./match";

/** The learned keywords, ordered by keyword (design Decision 10). */
export async function listKeywords(db: D1Database): Promise<LearnedKeyword[]> {
  const { results } = await db
    .prepare("SELECT keyword, category_id, source FROM keyword_map ORDER BY keyword")
    .all<{ keyword: string; category_id: string; source: LearnedSource }>();
  return results.map((row) => ({ keyword: row.keyword, categoryId: row.category_id, source: row.source }));
}
