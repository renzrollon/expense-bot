import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STEPS } from "./setup.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const guide = read("../docs/setup.md");
const pkg = JSON.parse(read("../package.json"));

const SECTIONS = [
  "Create the bot",
  "Turn privacy mode off",
  "Create the database",
  "Set the secrets and settings",
  "Store the allowed chat id",
  "Deploy",
  "Register and verify the webhook",
  "Troubleshooting",
];

test("guide sections appear in the expected order", () => {
  const headings = [...guide.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, SECTIONS);
});

test("every npm script the guide names exists in package.json", () => {
  const names = new Set([...guide.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]));
  for (const required of ["setup", "deploy", "dev", "db:migrate:local", "db:migrate:remote"]) {
    assert.ok(names.has(required), `guide does not name npm run ${required}`);
  }
  for (const name of names) {
    assert.ok(pkg.scripts[name], `npm script "${name}" is named in the guide but missing`);
  }
});

test("every setup step the guide names is a real step, and all steps are covered", () => {
  const named = new Set([...guide.matchAll(/npm run setup -- ([\w-]+)/g)].map((m) => m[1]));
  for (const step of named) {
    assert.ok(STEPS.includes(step), `setup step "${step}" is not implemented`);
  }
  for (const step of STEPS) {
    assert.ok(named.has(step), `guide does not mention setup step "${step}"`);
  }
});
