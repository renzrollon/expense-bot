/**
 * Parses JSON that may hold `//` and block comments and trailing commas, as Wrangler
 * accepts in `wrangler.jsonc`. Text inside a string is left as it is.
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonc(text) {
  let json = "";
  // Where the last comma outside a string sits in `json`, while only white space and comments follow it.
  let comma = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      json += text.slice(start, i + 1);
      comma = -1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      if ((char === "}" || char === "]") && comma !== -1) json = json.slice(0, comma) + json.slice(comma + 1);
      if (char === ",") comma = json.length;
      else if (!/\s/.test(char)) comma = -1;
      json += char;
    }
  }
  return JSON.parse(json);
}
