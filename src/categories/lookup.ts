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

/** The ids of the categories that do not count as spending (design Decision 11). */
export const NOT_COUNTED_IDS: readonly string[] = CATEGORIES.filter((category) => !category.countsAsSpending).map(
  (category) => category.id,
);

/** Whether a category counts as spending. `true` for an id not in the list. Never throws. */
export function countsAsSpending(id: string): boolean {
  return BY_ID.get(id)?.countsAsSpending ?? true;
}
