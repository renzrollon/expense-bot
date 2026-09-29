/**
 * Parses the text of a `.dev.vars` file into a record (Decision 12, D59).
 * Reads lines of `KEY=value`, skips blank lines and lines that start with `#`,
 * and removes one pair of single or double quotes around a value.
 */
export function parseSecretsFile(text) {
  const record = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key === "") continue;
    record[key] = unquote(line.slice(eq + 1).trim());
  }
  return record;
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}
