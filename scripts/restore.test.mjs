import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const script = join(root, "scripts", "restore.mjs");

const EXPORT_COLUMNS =
  "id,spent_on,amount,currency,category_id,category_name,description,payer_name,created_at,deleted_at,raw_text";
const ENTRIES_HEADER = `${EXPORT_COLUMNS},chat_id,source_message_id,item_index,confirmation_message_id,payer_user_id,category_source,parser,check_amount,created_by,updated_at,updated_by,deleted_by,source_edited_at`;
const KEYWORDS_HEADER = "keyword,category_id,source,taught_by,hit_count,created_at,updated_at";

// The literal backup row of the data-export spec, entry 7.
const ENTRY_7 =
  "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250,'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,";
const ENTRY_7_REMOVED =
  "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,2026-09-30T01:00:00.000Z,lunch 250,'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-30T01:00:00.000Z,1001,1002,";
const ACAI = "acai,dining,learned,1001,3,2026-09-20T01:00:00.000Z,2026-09-25T01:00:00.000Z";

const file = (header, ...rows) => [header, ...rows].map((r) => `${r}\r\n`).join("");

let dir;
let counter = 0;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "restore-test-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function write(name, text) {
  const path = join(dir, `${counter++}-${name}`);
  writeFileSync(path, text);
  return path;
}

function run(...paths) {
  return spawnSync(process.execPath, [script, ...paths], { encoding: "utf8" });
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(migrations.length, 5);
  for (const m of migrations) db.exec(readFileSync(join(root, "migrations", m), "utf8"));
  return db;
}

function restore(...texts) {
  const paths = texts.map((t, i) => write(`f${i}.csv`, t));
  const result = run(...paths);
  assert.equal(result.status, 0, result.stderr);
  const db = freshDb();
  db.exec(result.stdout);
  return db;
}

describe("provide a restore script and procedure", () => {
  test("Happy path — an entry comes back as it was", () => {
    const db = restore(file(ENTRIES_HEADER, ENTRY_7));
    const rows = db.prepare("SELECT * FROM expenses").all();
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, {
      id: 7,
      chat_id: -1001,
      source_message_id: 41,
      item_index: 0,
      confirmation_message_id: 900,
      payer_user_id: 1001,
      amount_centavos: 25000,
      currency: "PHP",
      description: "lunch",
      category_id: "dining",
      category_source: "keyword",
      spent_on: "2026-09-29",
      raw_text: "lunch 250",
      parser: "rules",
      check_amount: 0,
      created_at: "2026-09-29T02:00:03.000Z",
      created_by: 1001,
      updated_at: "2026-09-29T02:00:03.000Z",
      updated_by: 1001,
      deleted_at: null,
      deleted_by: null,
      source_edited_at: null,
    });
  });

  test("Happy path — a learned keyword comes back as it was", () => {
    const db = restore(file(KEYWORDS_HEADER, ACAI));
    assert.deepEqual({ ...db.prepare("SELECT * FROM keyword_map").get() }, {
      keyword: "acai",
      category_id: "dining",
      source: "learned",
      taught_by: 1001,
      hit_count: 3,
      created_at: "2026-09-20T01:00:00.000Z",
      updated_at: "2026-09-25T01:00:00.000Z",
    });
  });

  test("Failure — a file made by /export", () => {
    const path = write("export.csv", file(EXPORT_COLUMNS, "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250"));
    const result = run(path);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(path));
  });

  test("Failure — a header row that is not a backup header", () => {
    const path = write("other.csv", file("a,b,c", "1,2,3"));
    const result = run(path);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(path));
  });

  test("Failure — one bad file among good ones prints nothing", () => {
    const good = write("good.csv", file(ENTRIES_HEADER, ENTRY_7));
    const bad = write("bad.csv", file("a,b,c"));
    const result = run(good, bad);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(bad));
  });

  test("Edge case — quoted and neutralized cells", () => {
    const row =
      "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,\"'=1,2\",Ana,2026-09-29T02:00:03.000Z,,\"grab 180\r\ngroceries 2340\",'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,";
    const db = restore(file(ENTRIES_HEADER, row));
    const entry = db.prepare("SELECT description, raw_text, chat_id FROM expenses").get();
    assert.equal(entry.description, "=1,2");
    assert.equal(entry.raw_text, "grab 180\r\ngroceries 2340");
    assert.equal(entry.chat_id, -1001);
  });

  test("Edge case — a quote and an apostrophe inside text", () => {
    const row = ENTRY_7.replace(",lunch,Ana,", ",\"the \"\"good\"\" rice\",Ana,").replace(",lunch 250,", ",\"''til friday, o'clock\",");
    const db = restore(file(ENTRIES_HEADER, row));
    const entry = db.prepare("SELECT description, raw_text FROM expenses").get();
    assert.equal(entry.description, 'the "good" rice');
    assert.equal(entry.raw_text, "'til friday, o'clock");
  });

  test("Edge case — the same entry in two files", () => {
    const db = restore(file(ENTRIES_HEADER, ENTRY_7), file(ENTRIES_HEADER, ENTRY_7_REMOVED));
    const rows = db.prepare("SELECT id, deleted_at, deleted_by FROM expenses").all();
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, { id: 7, deleted_at: "2026-09-30T01:00:00.000Z", deleted_by: 1002 });
  });

  test("Edge case — the output can be applied twice", () => {
    const path = write("twice.csv", file(ENTRIES_HEADER, ENTRY_7));
    const sql = run(path).stdout;
    const db = freshDb();
    db.exec(sql);
    db.exec(sql);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM expenses").get().n, 1);
  });

  test("Edge case — absent values and centavos", () => {
    const row =
      "7,2026-09-29,1500.50,PHP,dining,Dining & Delivery,,Ana,2026-09-29T02:00:03.000Z,,lunch 250,'-1001,41,0,,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,";
    const db = restore(file(ENTRIES_HEADER, row));
    const entry = db.prepare("SELECT * FROM expenses").get();
    assert.equal(entry.confirmation_message_id, null);
    assert.equal(entry.deleted_at, null);
    assert.equal(entry.deleted_by, null);
    assert.equal(entry.source_edited_at, null);
    assert.equal(entry.description, "");
    assert.equal(entry.amount_centavos, 150050);
  });

  test("Edge case — amounts without rounding", () => {
    const row = ENTRY_7.replace(",250.00,", ",0.05,");
    const db = restore(file(ENTRIES_HEADER, row));
    assert.equal(db.prepare("SELECT amount_centavos AS c FROM expenses").get().c, 5);
  });

  test("Edge case — a keyword with an apostrophe and no teacher", () => {
    const db = restore(file(KEYWORDS_HEADER, "o'clock,dining,llm,,0,2026-09-20T01:00:00.000Z,2026-09-20T01:00:00.000Z"));
    const kw = db.prepare("SELECT * FROM keyword_map").get();
    assert.equal(kw.keyword, "o'clock");
    assert.equal(kw.taught_by, null);
  });
});
