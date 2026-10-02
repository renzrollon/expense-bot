// Prints SQL that puts the rows of backup files back into the database.
// Usage: node scripts/restore.mjs <file>... > restore.sql
// Files are read in the order given, so give the oldest first. Nothing is applied.
import { readFileSync } from "node:fs";
import { toStatements } from "./lib/backup-csv.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/restore.mjs <backup-file.csv>... > restore.sql");
  process.exit(2);
}

const output = [];
const errors = [];
for (const file of files) {
  try {
    output.push(...toStatements(file, readFileSync(file, "utf8")));
  } catch (error) {
    errors.push(error.code === "ENOENT" ? `${file}: cannot read the file` : error.message);
  }
}

if (errors.length > 0) {
  for (const message of errors) console.error(message);
  process.exit(1);
}
if (output.length > 0) process.stdout.write(`${output.join("\n")}\n`);
