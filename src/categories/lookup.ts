import { CATEGORIES, type Category } from "./categories";

/** The category used when nothing matched (design Decision 7). */
export const FALLBACK_CATEGORY_ID = "other";

const BY_ID: ReadonlyMap<string, Category> = new Map(CATEGORIES.map((category) => [category.id, category]));

/** Whether a category in the list has exactly this id. Never throws. */
export function isCategoryId(id: string): boolean {
  return BY_ID.has(id);
}

/** The category with this id, or `undefined` for an id not in the list. Never throws. */
export function getCategory(id: string): Category | undefined {
  return BY_ID.get(id);
}
