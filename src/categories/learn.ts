import { normalizeKeyword, normalizeWords } from "./normalize";

/** The most words a learnable description may have (design Decision 10). */
const MAX_LEARNABLE_WORDS = 3;

/**
 * The keyword to teach for a description, or `null` when it is not learnable
 * (design Decision 10): a description is learnable when it normalizes to 1 to 3 words.
 */
export function learnableKeyword(description: string): string | null {
  const count = normalizeWords(description).length;
  return count >= 1 && count <= MAX_LEARNABLE_WORDS ? normalizeKeyword(description) : null;
}
