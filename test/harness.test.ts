import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ALLOWED_USER_IDS_TEXT, BOT_INFO, BOT_TOKEN, HOUSEHOLD_TZ, WEBHOOK_SECRET } from "./helpers/constants";
import { TABLES, resetTables } from "./helpers/db";

describe("harness", () => {
  it("creates the three tables from the migration", async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('updates', 'members', 'settings') ORDER BY name",
    ).all<{ name: string }>();
    expect(rows.results.map((row) => row.name)).toEqual(["members", "settings", "updates"]);
  });

  it("creates the expenses and keyword_map tables from the migrations", async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('expenses', 'keyword_map') ORDER BY name",
    ).all<{ name: string }>();
    expect(rows.results.map((row) => row.name)).toEqual(["expenses", "keyword_map"]);
  });

  it("gives every binding a value", () => {
    expect(env.BOT_TOKEN).toBe(BOT_TOKEN);
    expect(env.WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
    expect(JSON.parse(env.BOT_INFO)).toEqual(BOT_INFO);
    expect(env.ALLOWED_USER_IDS).toBe(ALLOWED_USER_IDS_TEXT);
    expect(env.HOUSEHOLD_TZ).toBe(HOUSEHOLD_TZ);
    expect(env.DB).toBeDefined();
    expect(env.TEST_MIGRATIONS.length).toBeGreaterThan(0);
  });

  it("empties every table on reset", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('k', 'v', 't')"),
      env.DB.prepare(
        "INSERT INTO members (user_id, display_name, first_seen_at, updated_at) VALUES (1, 'A', 't', 't')",
      ),
      env.DB.prepare(
        "INSERT INTO updates (update_id, kind, chat_id, raw, status, attempts, received_at, claimed_at) VALUES (1, 'message', 1, '{}', 'done', 1, 't', 't')",
      ),
      env.DB.prepare(
        "INSERT INTO expenses (chat_id, source_message_id, item_index, payer_user_id, amount_centavos, currency, description, category_id, category_source, spent_on, raw_text, parser, check_amount, created_at, created_by, updated_at, updated_by) VALUES (-1001, 10, 0, 1001, 25000, 'PHP', 'lunch', 'dining', 'keyword', '2026-09-29', 'lunch 250', 'rules', 0, 't', 1001, 't', 1001)",
      ),
      env.DB.prepare(
        "INSERT INTO keyword_map (keyword, category_id, source, taught_by, created_at, updated_at) VALUES ('kape', 'dining', 'learned', 1001, 't', 't')",
      ),
    ]);
    for (const table of ["expenses", "keyword_map"]) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n).toBe(1);
    }
    await resetTables(env.DB);
    for (const table of TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });
});
