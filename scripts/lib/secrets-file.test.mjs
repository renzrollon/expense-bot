import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSecretsFile } from "./secrets-file.mjs";

test("parses KEY=value lines", () => {
  assert.deepEqual(parseSecretsFile("BOT_TOKEN=abc\nWEBHOOK_SECRET=def\n"), {
    BOT_TOKEN: "abc",
    WEBHOOK_SECRET: "def",
  });
});

test("skips blank lines and lines that start with #", () => {
  const text = "\n# a comment\nBOT_TOKEN=abc\n\n   \n# BOT_TOKEN=other\nWEBHOOK_SECRET=def\n";
  assert.deepEqual(parseSecretsFile(text), { BOT_TOKEN: "abc", WEBHOOK_SECRET: "def" });
});

test("removes one pair of double quotes around a value", () => {
  assert.deepEqual(parseSecretsFile('BOT_TOKEN="123:abc"\n'), { BOT_TOKEN: "123:abc" });
});

test("removes one pair of single quotes around a value", () => {
  assert.deepEqual(parseSecretsFile("BOT_TOKEN='123:abc'\n"), { BOT_TOKEN: "123:abc" });
});

test("removes only one pair of quotes", () => {
  assert.deepEqual(parseSecretsFile("A=\"'x'\"\n"), { A: "'x'" });
});

test("keeps an equals sign inside the value", () => {
  assert.deepEqual(parseSecretsFile("A=b=c\n"), { A: "b=c" });
});

test("returns an empty record for empty text", () => {
  assert.deepEqual(parseSecretsFile(""), {});
});

test("handles Windows line endings", () => {
  assert.deepEqual(parseSecretsFile("A=1\r\n# c\r\nB=\"2\"\r\n"), { A: "1", B: "2" });
});
