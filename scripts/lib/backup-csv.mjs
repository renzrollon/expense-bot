// Reads the backup files the bot sends and turns them into SQL.
// Pure and dependency-free: it does not import the TypeScript encoder.

const EXPORT_COLUMNS = [
  "id", "spent_on", "amount", "currency", "category_id", "category_name",
  "description", "payer_name", "created_at", "deleted_at", "raw_text",
];
const ENTRIES_HEADER = [
  ...EXPORT_COLUMNS,
  "chat_id", "source_message_id", "item_index", "confirmation_message_id",
  "payer_user_id", "category_source", "parser", "check_amount", "created_by",
  "updated_at", "updated_by", "deleted_by", "source_edited_at",
];
const KEYWORDS_HEADER = [
  "keyword", "category_id", "source", "taught_by", "hit_count", "created_at", "updated_at",
];

// Columns that are not stored.
const NOT_STORED = new Set(["category_name", "payer_name"]);
const ENTRY_INTEGERS = new Set([
  "id", "chat_id", "source_message_id", "item_index", "confirmation_message_id",
  "payer_user_id", "check_amount", "created_by", "updated_by", "deleted_by",
]);
const ENTRY_NULLABLE = new Set([
  "confirmation_message_id", "deleted_at", "deleted_by", "source_edited_at",
]);
const KEYWORD_INTEGERS = new Set(["taught_by", "hit_count"]);
const KEYWORD_NULLABLE = new Set(["taught_by"]);

/** Reads CSV text (RFC 4180 quoting, CRLF rows) into an array of rows of cells. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let pending = false; // a row or cell has started
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      pending = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      pending = true;
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      pending = false;
      i++;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      pending = false;
    } else {
      cell += ch;
      pending = true;
    }
  }
  if (quoted) throw new Error("unterminated quoted cell");
  if (pending) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Takes the one leading ' off a cell, which the encoder added. */
export function decodeCell(cell) {
  return cell.startsWith("'") ? cell.slice(1) : cell;
}

const textLiteral = (s) => `'${s.replaceAll("'", "''")}'`;

function integerLiteral(column, value) {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${column} is not a whole number: ${JSON.stringify(value)}`);
  }
  return String(Number(value));
}

function centavos(value) {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error(`amount is not in pesos with two decimals: ${JSON.stringify(value)}`);
  const n = Number(match[1]) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(n)) throw new Error(`amount is too large: ${value}`);
  return String(n);
}

function sameHeader(a, b) {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function statementFor(table, header, cells, integers, nullable) {
  const columns = [];
  const values = [];
  header.forEach((column, i) => {
    if (NOT_STORED.has(column)) return;
    const raw = cells[i];
    const value = decodeCell(raw);
    let literal;
    if (column === "amount") {
      columns.push("amount_centavos");
      values.push(centavos(value));
      return;
    }
    if (raw === "" && nullable.has(column)) literal = "NULL";
    else if (integers.has(column)) literal = integerLiteral(column, value);
    else literal = textLiteral(value);
    columns.push(column);
    values.push(literal);
  });
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

/** Returns the SQL statements of one backup file, or throws when it is not one. */
export function toStatements(fileName, text) {
  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    throw new Error(`${fileName}: ${error.message}`);
  }
  const header = rows[0];
  let table;
  let integers;
  let nullable;
  if (header && sameHeader(header, ENTRIES_HEADER)) {
    [table, integers, nullable] = ["expenses", ENTRY_INTEGERS, ENTRY_NULLABLE];
  } else if (header && sameHeader(header, KEYWORDS_HEADER)) {
    [table, integers, nullable] = ["keyword_map", KEYWORD_INTEGERS, KEYWORD_NULLABLE];
  } else {
    throw new Error(`${fileName}: not a backup file (its header row is not a backup header)`);
  }
  return rows.slice(1).map((cells, i) => {
    if (cells.length !== header.length) {
      throw new Error(`${fileName}: row ${i + 2} has ${cells.length} cells, expected ${header.length}`);
    }
    try {
      return statementFor(table, header, cells, integers, nullable);
    } catch (error) {
      throw new Error(`${fileName}: row ${i + 2}: ${error.message}`);
    }
  });
}
