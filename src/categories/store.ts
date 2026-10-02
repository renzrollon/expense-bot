import { isCategoryId } from "./lookup";
import type { LearnedKeyword, LearnedSource } from "./match";
import { normalizeKeyword } from "./normalize";

/** The learned keywords, ordered by keyword (design Decision 10). */
export async function listKeywords(db: D1Database): Promise<LearnedKeyword[]> {
  const { results } = await db
    .prepare("SELECT keyword, category_id, source FROM keyword_map ORDER BY keyword")
    .all<{ keyword: string; category_id: string; source: LearnedSource }>();
  return results.map((row) => ({ keyword: row.keyword, categoryId: row.category_id, source: row.source }));
}

/** One row of `keyword_map` with every field, as a backup holds it. */
export interface KeywordRow {
  keyword: string;
  categoryId: string;
  source: LearnedSource;
  taughtBy: number | null;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What teaching a keyword needs (design Decision 10). */
export interface TeachKeywordInput {
  keyword: string;
  categoryId: string;
  taughtBy: number;
  now: Date;
}

/**
 * Stores a learned keyword for a category, in one statement (design Decision 10).
 * The latest teaching wins; the same teaching again changes nothing. Throws
 * `RangeError`, before any statement, for a keyword that normalizes to no words
 * or a category id not in the list.
 */
export async function teachKeyword(db: D1Database, input: TeachKeywordInput): Promise<void> {
  const keyword = normalizeKeyword(input.keyword);
  if (keyword === "") throw new RangeError("teachKeyword: the keyword normalizes to no words");
  if (!isCategoryId(input.categoryId)) {
    throw new RangeError(`teachKeyword: unknown category id ${JSON.stringify(input.categoryId)}`);
  }
  await db
    .prepare(
      `INSERT INTO keyword_map (keyword, category_id, source, taught_by, hit_count, created_at, updated_at)
       VALUES (?1, ?2, 'learned', ?3, 0, ?4, ?4)
       ON CONFLICT (keyword) DO UPDATE SET
         category_id = excluded.category_id, source = 'learned',
         taught_by = excluded.taught_by, updated_at = excluded.updated_at
       WHERE keyword_map.category_id <> excluded.category_id OR keyword_map.source <> 'learned'`,
    )
    .bind(keyword, input.categoryId, input.taughtBy, input.now.toISOString())
    .run();
}

/** Every row of `keyword_map` with every field, ordered by keyword. */
export async function listKeywordRows(db: D1Database): Promise<KeywordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT keyword, category_id, source, taught_by, hit_count, created_at, updated_at
       FROM keyword_map ORDER BY keyword`,
    )
    .all<{
      keyword: string;
      category_id: string;
      source: LearnedSource;
      taught_by: number | null;
      hit_count: number;
      created_at: string;
      updated_at: string;
    }>();
  return results.map((row) => ({
    keyword: row.keyword,
    categoryId: row.category_id,
    source: row.source,
    taughtBy: row.taught_by,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
