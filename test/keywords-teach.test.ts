import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createMatcher, listKeywordRows, listKeywords, teachKeyword, type KeywordRow } from "../src/categories";
import { MEMBER_A, MEMBER_B } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";

useCleanTables(env.DB);

const db = env.DB;
const FIRST = new Date("2026-09-29T02:10:00.000Z");
const LATER = new Date("2026-09-30T02:00:00.000Z");

async function insertRaw(row: {
  keyword: string;
  category_id: string;
  source: "learned" | "llm";
  taught_by: number | null;
  at: string;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO keyword_map (keyword, category_id, source, taught_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.keyword, row.category_id, row.source, row.taught_by, row.at, row.at)
    .run();
}

function learned(keyword: string, categoryId: string, taughtBy: number, created: Date, updated = created): KeywordRow {
  return {
    keyword,
    categoryId,
    source: "learned",
    taughtBy,
    hitCount: 0,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
  };
}

describe("Learned keywords table", () => {
  it("Read the table in full", async () => {
    await insertRaw({ keyword: "bubble tea", category_id: "dining", source: "llm", taught_by: null, at: "2026-09-28T01:00:00.000Z" });
    await insertRaw({ keyword: "acai", category_id: "dining", source: "learned", taught_by: MEMBER_A.id, at: FIRST.toISOString() });
    expect(await listKeywordRows(db)).toEqual([
      learned("acai", "dining", MEMBER_A.id, FIRST),
      {
        keyword: "bubble tea",
        categoryId: "dining",
        source: "llm",
        taughtBy: null,
        hitCount: 0,
        createdAt: "2026-09-28T01:00:00.000Z",
        updatedAt: "2026-09-28T01:00:00.000Z",
      },
    ]);
  });

  it("An empty table reads in full as an empty list", async () => {
    expect(await listKeywordRows(db)).toEqual([]);
  });
});

describe("Teaching a keyword", () => {
  it("Happy path — a new keyword", async () => {
    await teachKeyword(db, { keyword: "acai", categoryId: "dining", taughtBy: MEMBER_A.id, now: FIRST });
    expect(await listKeywordRows(db)).toEqual([learned("acai", "dining", MEMBER_A.id, FIRST)]);
    const match = createMatcher(await listKeywords(db))("acai bowl");
    expect(match.categoryId).toBe("dining");
    expect(match.source).toBe("learned");
  });

  it("Happy path — the latest teaching wins", async () => {
    await teachKeyword(db, { keyword: "acai", categoryId: "dining", taughtBy: MEMBER_A.id, now: FIRST });
    await teachKeyword(db, { keyword: "acai", categoryId: "groceries", taughtBy: MEMBER_B.id, now: LATER });
    expect(await listKeywordRows(db)).toEqual([learned("acai", "groceries", MEMBER_B.id, FIRST, LATER)]);
  });

  it.each([
    ["the keyword !!", "!!", "dining"],
    ["an empty keyword", "", "dining"],
    ["a category not in the list", "acai", "snacks"],
  ])("Failure — a keyword or a category that cannot be taught: %s", async (_label, keyword, categoryId) => {
    await teachKeyword(db, { keyword: "milk tea", categoryId: "dining", taughtBy: MEMBER_A.id, now: FIRST });
    const before = await listKeywordRows(db);
    await expect(teachKeyword(db, { keyword, categoryId, taughtBy: MEMBER_A.id, now: LATER })).rejects.toThrow(RangeError);
    expect(await listKeywordRows(db)).toEqual(before);
  });

  it("Edge case — casing, spacing and accents give one row", async () => {
    await teachKeyword(db, { keyword: "  AÇAÍ   Bowl ", categoryId: "dining", taughtBy: MEMBER_A.id, now: FIRST });
    await teachKeyword(db, { keyword: "acai bowl", categoryId: "dining", taughtBy: MEMBER_A.id, now: LATER });
    const rows = await listKeywordRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyword).toBe("acai bowl");
  });

  it("Edge case — a manual teaching replaces a guess", async () => {
    await insertRaw({ keyword: "acai", category_id: "fun", source: "llm", taught_by: null, at: FIRST.toISOString() });
    await teachKeyword(db, { keyword: "acai", categoryId: "dining", taughtBy: MEMBER_A.id, now: LATER });
    expect(await listKeywordRows(db)).toEqual([learned("acai", "dining", MEMBER_A.id, FIRST, LATER)]);
  });

  it("Edge case — the same teaching again changes nothing", async () => {
    await teachKeyword(db, { keyword: "acai", categoryId: "dining", taughtBy: MEMBER_A.id, now: FIRST });
    await teachKeyword(db, { keyword: "acai", categoryId: "dining", taughtBy: MEMBER_B.id, now: LATER });
    expect(await listKeywordRows(db)).toEqual([learned("acai", "dining", MEMBER_A.id, FIRST)]);
  });
});
