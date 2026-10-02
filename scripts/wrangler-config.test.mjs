import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const text = readFileSync(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8");
// JSONC allows comments. Only whole-line `//` comments are removed, so a `//` inside a string stays.
const config = JSON.parse(
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n"),
);

test("the Worker has exactly one cron trigger, at the start of every hour", () => {
  assert.deepEqual(config.triggers?.crons, ["0 * * * *"]);
});
