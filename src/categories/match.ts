import { SEED_KEYWORDS } from "./keywords";
import { FALLBACK_CATEGORY_ID, isCategoryId } from "./lookup";
import { normalizeWords } from "./normalize";

/** Where a learned keyword came from. */
export type LearnedSource = "learned" | "llm";

/** One row of `keyword_map`, as the matcher reads it. */
export interface LearnedKeyword {
  keyword: string;
  categoryId: string;
  source: LearnedSource;
}

/** Where a match came from. A subset of the ledger's `CategorySource`. */
export type MatchSource = LearnedSource | "keyword" | "default";

/** The category picked for one description (design Decision 10). */
export interface CategoryMatch {
  categoryId: string;
  source: MatchSource;
  keyword: string | null;
}

/** Picks the category of one description. */
export type Matcher = (description: string) => CategoryMatch;

/** One keyword ready to compare: its normalized words and the match it gives. */
interface Candidate {
  words: readonly string[];
  match: CategoryMatch;
}

/** Candidates by their first word. Each bucket keeps the order the candidates were given in. */
type Index = ReadonlyMap<string, readonly Candidate[]>;

function buildIndex(candidates: Iterable<Candidate>): Index {
  const index = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const first = candidate.words[0]!;
    const bucket = index.get(first);
    if (bucket) bucket.push(candidate);
    else index.set(first, [candidate]);
  }
  return index;
}

function* seedCandidates(): Generator<Candidate> {
  for (const [categoryId, keywords] of Object.entries(SEED_KEYWORDS)) {
    for (const keyword of keywords) {
      const words = normalizeWords(keyword);
      if (words.length === 0) continue;
      yield { words, match: { categoryId, source: "keyword", keyword } };
    }
  }
}

/** The seed tier, indexed once at module load (design Decision 10). */
const SEED_INDEX: Index = buildIndex(seedCandidates());

function* learnedCandidates(learned: readonly LearnedKeyword[]): Generator<Candidate> {
  for (const row of learned) {
    if (!isCategoryId(row.categoryId)) continue; // D30: a removed category is skipped.
    const words = normalizeWords(row.keyword);
    if (words.length === 0) continue; // D56: a keyword with no words is skipped.
    yield { words, match: { categoryId: row.categoryId, source: row.source, keyword: row.keyword } };
  }
}

function startsAt(words: readonly string[], i: number, keyword: readonly string[]): boolean {
  if (i + keyword.length > words.length) return false;
  return keyword.every((word, j) => words[i + j] === word);
}

/**
 * The best match of one tier: the most words, then the smallest start, then the
 * first given. Positions run from the start and buckets keep their order, so a
 * candidate replaces the best only when it has strictly more words (D28, D29).
 */
function bestOf(index: Index, words: readonly string[]): CategoryMatch | null {
  let best: Candidate | null = null;
  for (let i = 0; i < words.length; i++) {
    for (const candidate of index.get(words[i]!) ?? []) {
      if (best !== null && candidate.words.length <= best.words.length) continue;
      if (startsAt(words, i, candidate.words)) best = candidate;
    }
  }
  return best === null ? null : { ...best.match };
}

/** Builds the matcher for one message: learned keywords first, then seeds, then `other` (Decision 10). */
export function createMatcher(learned: readonly LearnedKeyword[]): Matcher {
  const learnedIndex = buildIndex(learnedCandidates(learned));
  return (description) => {
    const words = normalizeWords(description);
    return (
      bestOf(learnedIndex, words) ??
      bestOf(SEED_INDEX, words) ?? { categoryId: FALLBACK_CATEGORY_ID, source: "default", keyword: null }
    );
  };
}
