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

  it("gives every binding a value", () => {
    expect(env.BOT_TOKEN).toBe(BOT_TOKEN);
    expect(env.WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
    expect(JSON.parse(env.BOT_INFO)).toEqual(BOT_INFO);
    expect(env.ALLOWED_USER_IDS).toBe(ALLOWED_USER_IDS_TEXT);
    expect(env.HOUSEHOLD_TZ).toBe(HOUSEHOLD_TZ);
    expect(env.DB).toBeDefined();
    expect(env.TEST_MIGRATIONS.length).toBeGreaterThan(0);
  });

  it("empties the three tables on reset", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('k', 'v', 't')"),
      env.DB.prepare(
        "INSERT INTO members (user_id, display_name, first_seen_at, updated_at) VALUES (1, 'A', 't', 't')",
      ),
      env.DB.prepare(
        "INSERT INTO updates (update_id, kind, chat_id, raw, status, attempts, received_at, claimed_at) VALUES (1, 'message', 1, '{}', 'done', 1, 't', 't')",
      ),
    ]);
    await resetTables(env.DB);
    for (const table of TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });
});
