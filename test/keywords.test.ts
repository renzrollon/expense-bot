import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listKeywords } from "../src/categories";
import { MEMBER_A } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";

useCleanTables(env.DB);

const db = env.DB;
const NOW = "2026-09-29T10:00:00.000Z";

interface KeywordRow {
  keyword: string;
  category_id: string;
  source: "learned" | "llm";
  taught_by: number | null;
}

async function insertKeyword(row: KeywordRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO keyword_map (keyword, category_id, source, taught_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.keyword, row.category_id, row.source, row.taught_by, NOW, NOW)
    .run();
}

describe("Learned keywords table", () => {
  it("The table starts empty", async () => {
    const table = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keyword_map'")
      .first<{ name: string }>();
    expect(table).toEqual({ name: "keyword_map" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM keyword_map").first<{ n: number }>()).toEqual({ n: 0 });
    expect(await listKeywords(db)).toEqual([]);
  });

  it("A keyword appears once", async () => {
    const acai: KeywordRow = { keyword: "acai", category_id: "dining", source: "learned", taught_by: MEMBER_A.id };
    await expect(insertKeyword(acai)).resolves.toBeUndefined();
    await expect(insertKeyword({ ...acai, category_id: "kids" })).rejects.toThrow(
      /UNIQUE constraint failed: keyword_map\.keyword/,
    );
  });

  it("Read the learned keywords", async () => {
    await insertKeyword({ keyword: "bubble tea", category_id: "dining", source: "llm", taught_by: null });
    await insertKeyword({ keyword: "acai", category_id: "dining", source: "learned", taught_by: MEMBER_A.id });
    expect(await listKeywords(db)).toEqual([
      { keyword: "acai", categoryId: "dining", source: "learned" },
      { keyword: "bubble tea", categoryId: "dining", source: "llm" },
    ]);
  });

  it("The learned keywords migration inserts no rows", () => {
    const migrations = env.TEST_MIGRATIONS.filter((m) => m.name === "0003_categorization.sql");
    expect(migrations).toHaveLength(1);
    const { queries } = migrations[0]!;
    expect(queries.some((q) => q.includes("CREATE TABLE keyword_map"))).toBe(true);
    expect(queries.filter((q) => /^\s*insert\b/i.test(q))).toEqual([]);
  });
});
