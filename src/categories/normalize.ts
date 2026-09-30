const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * The normalized words of a text (design Decision 8): composed, lower case,
 * curly apostrophes made straight, accents removed, split at white space, with
 * every non-letter and non-digit removed from both ends of each word.
 */
export function normalizeWords(text: string): string[] {
  const folded = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC");
  return folded
    .split(/\s+/u)
    .map((word) => word.replace(EDGE_PUNCTUATION, ""))
    .filter((word) => word !== "");
}

/** A normalized keyword: its normalized words joined by single spaces. */
export function normalizeKeyword(text: string): string {
  return normalizeWords(text).join(" ");
}
