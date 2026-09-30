export type Token =
  | { kind: "word"; text: string; bare: string }
  | { kind: "separator"; text: "\n" | "," | ";" | "+" }
  | { kind: "and"; text: string };

/** 1 to 3 digits, then groups of a comma and exactly 3 digits, with no digit around (D23). */
const GROUPED_NUMBER = /(?<![0-9])[0-9]{1,3}(?:,[0-9][0-9][0-9])+(?![0-9])/g;

const WHITE_SPACE = /\s/;

/** Punctuation at the ends of a word that is ignored when it is read (D35). */
const LEADING = new Set(["(", "[", "{", '"', "'", "“", "‘", "«"]);
const TRAILING = new Set([")", "]", "}", '"', "'", "”", "’", "»", ".", "!", ":"]);

/**
 * Splits the text into words and separators in one walk (design Decision 4). New
 * lines, `,`, `;` and `+` separate, except the commas of grouped numbers. The word
 * `and` becomes a token of its own. Every token keeps its text as typed.
 */
export function splitWords(text: string): Token[] {
  const keptCommas = new Set<number>();
  for (const match of text.matchAll(GROUPED_NUMBER)) {
    for (let index = match.index; index < match.index + match[0].length; index++) {
      if (text[index] === ",") keptCommas.add(index);
    }
  }

  const tokens: Token[] = [];
  let start = -1;
  const endWord = (end: number): void => {
    if (start >= 0) tokens.push(wordToken(text.slice(start, end)));
    start = -1;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (char === "\r" || char === "\n") {
      endWord(index);
      if (char === "\r" && text[index + 1] === "\n") index++;
      tokens.push({ kind: "separator", text: "\n" });
    } else if (WHITE_SPACE.test(char)) {
      endWord(index);
    } else if (char === ";" || char === "+" || (char === "," && !keptCommas.has(index))) {
      endWord(index);
      tokens.push({ kind: "separator", text: char });
    } else if (start < 0) {
      start = index;
    }
  }
  endWord(text.length);
  return tokens;
}

function wordToken(text: string): Token {
  const bare = bareForm(text);
  return bare.toLowerCase() === "and" ? { kind: "and", text } : { kind: "word", text, bare };
}

/** The word without every ignored character at either end. */
function bareForm(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && LEADING.has(text[start] as string)) start++;
  while (end > start && TRAILING.has(text[end - 1] as string)) end--;
  return text.slice(start, end);
}
