import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "./jsonc.mjs";

test("plain JSON is parsed as it is", () => {
  assert.deepEqual(parseJsonc('{ "a": [1, 2], "b": "x" }'), { a: [1, 2], b: "x" });
});

test("whole-line, end-of-line and block comments are removed", () => {
  const text = [
    "// the Worker",
    "{",
    '  "name": "expense-bot", // its name',
    '  /* the hour */ "hour": "21"',
    "}",
  ].join("\n");
  assert.deepEqual(parseJsonc(text), { name: "expense-bot", hour: "21" });
});

test("trailing commas are removed, also before a comment", () => {
  const text = '{ "crons": ["0 * * * *",], "vars": { "A": "1", // last\n }, }';
  assert.deepEqual(parseJsonc(text), { crons: ["0 * * * *"], vars: { A: "1" } });
});

test("a string keeps its slashes, commas, brackets and escaped quotes", () => {
  const text = '{ "url": "https://example.test/a", "info": "{\\"id\\":1,}", "note": "a /* b */ c, ]" }';
  assert.deepEqual(parseJsonc(text), { url: "https://example.test/a", info: '{"id":1,}', note: "a /* b */ c, ]" });
});

test("text that is not JSON still throws", () => {
  assert.throws(() => parseJsonc('{ "a": }'), SyntaxError);
});
