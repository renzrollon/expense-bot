import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./lib/jsonc.mjs";

// Only what a deploy must not change is checked here. The values under `vars` are the
// household's own settings, so no test reads them.
const config = parseJsonc(readFileSync(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8"));

test("the Worker has exactly one cron trigger, at the start of every hour", () => {
  assert.deepEqual(config.triggers?.crons, ["0 * * * *"]);
});

test("the database binding is named DB and points at the migrations folder", () => {
  assert.equal(config.d1_databases?.length, 1);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.d1_databases[0].migrations_dir, "migrations");
});
