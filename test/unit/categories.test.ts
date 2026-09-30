import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  FALLBACK_CATEGORY_ID,
  SEED_KEYWORDS,
  createMatcher,
  getCategory,
  isCategoryId,
  normalizeKeyword,
  normalizeWords,
  type Category,
  type CategoryMatch,
  type LearnedKeyword,
} from "../../src/categories";

function category(
  order: number,
  id: string,
  emoji: string,
  name: string,
  shortName: string,
  countsAsSpending = true,
): Category {
  return { id, name, shortName, emoji, order, countsAsSpending };
}

/** The default list of the categorization spec. No emoji carries U+FE0F. */
const DEFAULT_LIST: Category[] = [
  category(1, "groceries", "🛒", "Groceries & Market", "Groceries"),
  category(2, "dining", "🍽", "Dining & Delivery", "Dining"),
  category(3, "transport", "🚗", "Transport", "Transport"),
  category(4, "bills", "💡", "Bills & Utilities", "Bills"),
  category(5, "housing", "🏠", "Housing", "Housing"),
  category(6, "household", "🧹", "Household", "Household"),
  category(7, "health", "💊", "Health", "Health"),
  category(8, "kids", "🎒", "Kids & Education", "Kids"),
  category(9, "family", "🤝", "Family Support", "Family"),
  category(10, "gifts", "🎁", "Gifts & Occasions", "Gifts"),
  category(11, "personal", "🛍", "Personal & Shopping", "Personal"),
  category(12, "fun", "🎬", "Fun & Subscriptions", "Fun"),
  category(13, "other", "❓", "Other", "Other"),
  category(14, "transfer", "🔁", "Transfers", "Transfers", false),
];

describe("Category list", () => {
  it("The default list", () => {
    expect(CATEGORIES).toEqual(DEFAULT_LIST);
  });

  it("Transfers do not count as spending", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(getCategory("transfer")?.countsAsSpending).toBe(false);
    const others = CATEGORIES.filter((c) => c.id !== "transfer");
    expect(others).toHaveLength(13);
    for (const c of others) expect([c.id, c.countsAsSpending]).toEqual([c.id, true]);
  });

  it("The list's invariants hold", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]{1,12}$/);
    const orders = CATEGORIES.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(ids).toContain("other");
    expect(FALLBACK_CATEGORY_ID).toBe("other");
  });
});

describe("Category id validation", () => {
  it("A known id", () => {
    expect(isCategoryId("dining")).toBe(true);
    expect(getCategory("dining")).toEqual(category(2, "dining", "🍽", "Dining & Delivery", "Dining"));
  });

  it.each([
    { label: "snacks", id: "snacks" },
    { label: "Dining", id: "Dining" },
    { label: "an empty id", id: "" },
  ])("An id not in the list: $label", ({ id }) => {
    expect(isCategoryId(id)).toBe(false);
    expect(getCategory(id)).toBeUndefined();
  });
});

const SEEDED_EXAMPLES: [string, string][] = [
  ["jollibee", "dining"],
  ["lunch", "dining"],
  ["kape", "dining"],
  ["grab food", "dining"],
  ["palengke", "groceries"],
  ["puregold", "groceries"],
  ["ulam", "groceries"],
  ["grab", "transport"],
  ["angkas", "transport"],
  ["pamasahe", "transport"],
  ["toll", "transport"],
  ["meralco", "bills"],
  ["maynilad", "bills"],
  ["pldt", "bills"],
  ["load", "bills"],
  ["padala", "family"],
  ["regalo", "gifts"],
  ["pasalubong", "gifts"],
  ["cash in", "transfer"],
  ["withdraw", "transfer"],
];

describe("Seed keywords", () => {
  it("The examples are seeded", () => {
    for (const [keyword, categoryId] of SEEDED_EXAMPLES) {
      expect([keyword, SEED_KEYWORDS[categoryId] ?? []]).toEqual([keyword, expect.arrayContaining([keyword])]);
    }
  });

  it("The seed file's invariants hold", () => {
    const entries = Object.entries(SEED_KEYWORDS);
    expect(entries.length).toBeGreaterThan(0);
    expect(CATEGORIES.length).toBeGreaterThan(0);

    const all = entries.flatMap(([, keywords]) => keywords);
    for (const keyword of all) {
      expect(keyword).not.toBe("");
      expect(normalizeKeyword(keyword)).toBe(keyword);
    }
    expect(new Set(all).size).toBe(all.length);

    for (const [categoryId] of entries) expect([categoryId, isCategoryId(categoryId)]).toEqual([categoryId, true]);

    expect(SEED_KEYWORDS.other ?? []).toEqual([]);
    for (const c of CATEGORIES.filter((c) => c.id !== "other")) {
      expect([c.id, (SEED_KEYWORDS[c.id] ?? []).length >= 5]).toEqual([c.id, true]);
    }
    expect(all).not.toContain("gcash");
  });
});

describe("Text normalization", () => {
  it.each<{ label: string; text: string; words: string[] }>([
    { label: "brackets and a bang", text: "Lunch (Jollibee)!", words: ["lunch", "jollibee"] },
    { label: "an accent and two spaces", text: "Piña  Colada", words: ["pina", "colada"] },
    { label: "a hyphen inside a word", text: "7-Eleven", words: ["7-eleven"] },
    { label: "an ampersand inside a word", text: "S&R", words: ["s&r"] },
    { label: "an emoji word", text: "🍔 burger", words: ["burger"] },
    { label: "a straight apostrophe", text: "Jollibee's", words: ["jollibee's"] },
    { label: "a curly apostrophe", text: "McDonald’s", words: ["mcdonald's"] },
    { label: "a tab", text: "grab\tfood", words: ["grab", "food"] },
    { label: "three spaces", text: "   ", words: [] },
  ])("Normalized forms: $label", ({ text, words }) => {
    expect(normalizeWords(text)).toEqual(words);
  });

  it("A normalized keyword", () => {
    expect(normalizeKeyword("  Grab   FOOD ")).toBe("grab food");
  });
});

function learned(keyword: string, categoryId: string, source: LearnedKeyword["source"] = "learned"): LearnedKeyword {
  return { keyword, categoryId, source };
}

const NO_MATCH: CategoryMatch = { categoryId: "other", source: "default", keyword: null };

describe("Keyword matching", () => {
  it.each<{ label: string; learned: LearnedKeyword[]; description: string; expected: CategoryMatch }>([
    {
      label: "A seed keyword",
      learned: [],
      description: "lunch jollibee",
      expected: { categoryId: "dining", source: "keyword", keyword: "lunch" },
    },
    {
      label: "Whole words only",
      learned: [learned("book", "kids")],
      description: "facebook ads",
      expected: NO_MATCH,
    },
    {
      label: "A phrase beats a single word",
      learned: [],
      description: "grab food",
      expected: { categoryId: "dining", source: "keyword", keyword: "grab food" },
    },
    {
      label: "A tie goes to the first keyword",
      learned: [],
      description: "grab to jollibee",
      expected: { categoryId: "transport", source: "keyword", keyword: "grab" },
    },
    {
      label: "A phrase must be adjacent and in order: food grab",
      learned: [],
      description: "food grab",
      expected: { categoryId: "transport", source: "keyword", keyword: "grab" },
    },
    {
      label: "A phrase must be adjacent and in order: grab some food",
      learned: [],
      description: "grab some food",
      expected: { categoryId: "transport", source: "keyword", keyword: "grab" },
    },
    {
      label: "Case and punctuation do not matter",
      learned: [],
      description: "Lunch @ JOLLIBEE!",
      expected: { categoryId: "dining", source: "keyword", keyword: "lunch" },
    },
    {
      label: "Nothing matches",
      learned: [],
      description: "acai",
      expected: NO_MATCH,
    },
    {
      label: "An empty description",
      learned: [],
      description: "",
      expected: NO_MATCH,
    },
    {
      label: "A learned keyword wins over a seed keyword",
      learned: [learned("lunch", "kids")],
      description: "lunch jollibee",
      expected: { categoryId: "kids", source: "learned", keyword: "lunch" },
    },
    {
      label: "A learned word wins over a longer seed phrase",
      learned: [learned("food", "groceries")],
      description: "grab food",
      expected: { categoryId: "groceries", source: "learned", keyword: "food" },
    },
    {
      label: "A keyword guessed by the LLM",
      learned: [learned("acai", "dining", "llm")],
      description: "acai bowl",
      expected: { categoryId: "dining", source: "llm", keyword: "acai" },
    },
    {
      label: "A learned keyword for a removed category is skipped",
      learned: [learned("acai", "snacks")],
      description: "acai lunch",
      expected: { categoryId: "dining", source: "keyword", keyword: "lunch" },
    },
    {
      label: "A learned keyword with no words is skipped",
      learned: [learned("!!", "kids")],
      description: "lunch",
      expected: { categoryId: "dining", source: "keyword", keyword: "lunch" },
    },
    {
      label: "A learned keyword is compared in normalized form",
      learned: [learned("Açaí", "dining")],
      description: "acai bowl",
      expected: { categoryId: "dining", source: "learned", keyword: "Açaí" },
    },
    {
      label: "Two learned keywords with the same words",
      learned: [learned("Açaí", "dining"), learned("acai", "kids")],
      description: "acai bowl",
      expected: { categoryId: "dining", source: "learned", keyword: "Açaí" },
    },
    {
      label: "Accents do not matter",
      learned: [learned("pina", "dining")],
      description: "Piña shake",
      expected: { categoryId: "dining", source: "learned", keyword: "pina" },
    },
  ])("$label", ({ learned: rows, description, expected }) => {
    expect(createMatcher(rows)(description)).toEqual(expected);
  });
});
