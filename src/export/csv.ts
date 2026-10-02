/**
 * The one CSV encoder (design Decision 15; data-export, "write CSV files in one format").
 * UTF-8 text, no byte-order mark, comma-separated, every row ending in CRLF.
 */

/** A cell's value. `null` is an absent value and becomes an empty cell. */
export type CsvValue = string | number | null;

/** First characters a spreadsheet may run as a formula, plus `'` so the prefix can be undone. */
const FORMULA_START = /^[=+\-@']/;
/** Characters that need the cell put in double quotes. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Encodes one cell: `null` → empty, a number → its digits; then one `'` in front of a
 * leading `=`, `+`, `-`, `@` or `'`; then double quotes around a cell that holds a comma,
 * a double quote, a CR or an LF, with inner quotes doubled.
 */
export function csvCell(value: CsvValue): string {
  let text = value === null ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

/**
 * An amount in centavos as pesos with exactly two decimals, no sign and no grouping,
 * such as `1500.50`. Throws `RangeError` for anything but a non-negative safe integer.
 */
export function csvAmount(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new RangeError(`amount must be a non-negative whole number of centavos: ${centavos}`);
  }
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** The header row then each row, cells encoded with `csvCell`, every row ending in CRLF. */
export function csvFile(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  let text = "";
  for (const cells of [header, ...rows]) text += cells.map(csvCell).join(",") + "\r\n";
  return text;
}
