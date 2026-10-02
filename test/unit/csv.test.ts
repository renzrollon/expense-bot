import { describe, expect, it } from "vitest";
import { csvAmount, csvCell, csvFile, type CsvValue } from "../../src/export/csv";

const HEADER = [
  "id",
  "spent_on",
  "amount",
  "currency",
  "category_id",
  "category_name",
  "description",
  "payer_name",
  "created_at",
  "deleted_at",
  "raw_text",
];
const HEADER_LINE = HEADER.join(",") + "\r\n";

/** The row of entry 7 with its description and raw text replaced. */
function row(description: string, rawText = "lunch 250", centavos = 25_000): CsvValue[] {
  return [
    7,
    "2026-09-29",
    csvAmount(centavos),
    "PHP",
    "dining",
    "Dining & Delivery",
    description,
    "Ana",
    "2026-09-29T02:00:03.000Z",
    null,
    rawText,
  ];
}

/**
 * Reads CSV text by the same rules: comma-separated cells, double-quoted cells with
 * doubled quotes inside, rows ending in CRLF. Returns the cells as written, quotes removed.
 */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = "";
      i++;
    } else cell += char;
  }
  return rows;
}

describe("The system SHALL write CSV files in one format", () => {
  it("Happy path — a plain row", () => {
    expect(csvFile(HEADER, [row("lunch")])).toBe(
      HEADER_LINE +
        "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250\r\n",
    );
  });

  it("Failure — a cell that a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+63 load")).toBe("'+63 load");
    expect(csvCell("-50 refund")).toBe("'-50 refund");
    expect(csvCell("@home")).toBe("'@home");
    expect(csvFile(HEADER, [row("=SUM(A1:A9)")])).toBe(
      HEADER_LINE +
        "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,'=SUM(A1:A9),Ana,2026-09-29T02:00:03.000Z,,lunch 250\r\n",
    );
  });

  it("Edge case — commas, quotes and line breaks", () => {
    expect(csvCell("milk, eggs")).toBe('"milk, eggs"');
    expect(csvCell('the "good" rice')).toBe('"the ""good"" rice"');
    expect(csvCell("grab 180\ngroceries 2340")).toBe('"grab 180\ngroceries 2340"');
    expect(csvCell("grab 180\r\ngroceries 2340")).toBe('"grab 180\r\ngroceries 2340"');
    expect(csvCell("a\rb")).toBe('"a\rb"');

    const file = csvFile(HEADER, [
      row("milk, eggs"),
      row('the "good" rice'),
      row("groceries", "grab 180\ngroceries 2340"),
    ]);
    expect(file).toBe(
      HEADER_LINE +
        '7,2026-09-29,250.00,PHP,dining,Dining & Delivery,"milk, eggs",Ana,2026-09-29T02:00:03.000Z,,lunch 250\r\n' +
        '7,2026-09-29,250.00,PHP,dining,Dining & Delivery,"the ""good"" rice",Ana,2026-09-29T02:00:03.000Z,,lunch 250\r\n' +
        '7,2026-09-29,250.00,PHP,dining,Dining & Delivery,groceries,Ana,2026-09-29T02:00:03.000Z,,"grab 180\ngroceries 2340"\r\n',
    );

    const parsed = parse(file);
    expect(parsed).toHaveLength(4);
    for (const cells of parsed) expect(cells).toHaveLength(HEADER.length);
    expect(parsed[1]?.[6]).toBe("milk, eggs");
    expect(parsed[2]?.[6]).toBe('the "good" rice');
    expect(parsed[3]?.[10]).toBe("grab 180\ngroceries 2340");
  });

  it("Edge case — a cell that starts with an apostrophe", () => {
    expect(csvCell("'til friday")).toBe("''til friday");
    expect(csvCell("'til friday").slice(1)).toBe("'til friday");
  });

  it("Edge case — a formula with a comma", () => {
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });

  it("Edge case — amounts and other scripts", () => {
    expect(csvAmount(5)).toBe("0.05");
    expect(csvAmount(150_050)).toBe("1500.50");
    expect(csvCell("piña 🍍")).toBe("piña 🍍");
    expect(csvFile(HEADER, [row("piña 🍍", "piña 🍍 5", 5)])).toBe(
      HEADER_LINE +
        "7,2026-09-29,0.05,PHP,dining,Dining & Delivery,piña 🍍,Ana,2026-09-29T02:00:03.000Z,,piña 🍍 5\r\n",
    );
  });
});

describe("csvCell", () => {
  it.each<[string, CsvValue, string]>([
    ["null is an empty cell", null, ""],
    ["an empty string is an empty cell", "", ""],
    ["a number is its digits", 7, "7"],
    ["a negative number is treated as text that starts with -", -5, "'-5"],
    ["plain text is unchanged", "lunch", "lunch"],
    ["a formula character inside the text is unchanged", "a=b", "a=b"],
  ])("%s", (_label, value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe("csvAmount", () => {
  it.each<[number, string]>([
    [0, "0.00"],
    [25_000, "250.00"],
    [150_050, "1500.50"],
    [1_234_567_89, "1234567.89"],
  ])("%d centavos is %s", (centavos, expected) => {
    expect(csvAmount(centavos)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects %d", (centavos) => {
    expect(() => csvAmount(centavos)).toThrow(RangeError);
  });
});

describe("csvFile", () => {
  it("a file with no rows is the header and its CRLF", () => {
    expect(csvFile(["phrase", "category_id"], [])).toBe("phrase,category_id\r\n");
  });

  it("encodes header cells too", () => {
    expect(csvFile(["a,b", "=c"], [["x", null]])).toBe(`"a,b",'=c\r\nx,\r\n`);
  });

  it("has no byte-order mark", () => {
    expect(csvFile(HEADER, []).charCodeAt(0)).not.toBe(0xfeff);
  });
});
