import { readAmount, type AmountReading } from "./amounts";
import { localDate } from "./dates";
import { findDatePhrases } from "./phrases";
import type { Flag, ParsedItem, ParseResult, RejectionReason } from "./types";
import { splitWords, type Token } from "./words";

export type { Confidence, Flag, ParsedItem, ParseResult, RejectionReason } from "./types";

export const MAX_ITEMS = 10;

type WordToken = Extract<Token, { kind: "word" }>;
type Reading = Exclude<AmountReading, { kind: "not_amount" }>;

/** A number read from one word, or from a mark word and the number after it. */
interface Candidate {
  reading: Reading;
  /** The words used up by this amount. */
  words: WordToken[];
}

/** The words between two separating tokens, and the separating tokens before it. */
interface Part {
  junction: Token[];
  words: WordToken[];
  candidates: Candidate[];
}

/** One or more parts joined together, holding at least one amount. */
interface Group {
  /** Words and the `and` tokens that joined parts, in order. */
  pieces: Token[];
  candidates: Candidate[];
}

const NOT_EXPENSE: ParseResult = { kind: "not_expense" };

const MARK_WORDS = new Set(["₱", "php"]);
const NOT_AMOUNT_AFTER = new Set(["am", "pm", "%"]);
/** A plain number after one of these words is a time, a code, a reference or a year. */
const NOT_AMOUNT_BEFORE = new Set([
  "at",
  "alas",
  "otp",
  "pin",
  "code",
  "ref",
  "reference",
  "no",
  "number",
  "acct",
  "account",
  "year",
]);
/** A word that may stand between such a word and its number, as in `otp is 123456`. */
const LINK_WORDS = new Set(["is"]);
/** A word made only of the digits 0 to 9. */
const PLAIN_NUMBER = /^[0-9]+$/;
/** This many plain numbers in a row are a phone, card or account number. */
const DIGIT_GROUP_WORDS = 3;
/** A word made only of hyphens, dashes or colons. */
const DASHES = /^[-‐‑‒–—―:]+$/;

/**
 * Turns the text of one message into expense items, "not an expense" or a rejection
 * (design Decisions 2 and 3). Pure: no storage, no network, no log lines. It never
 * throws because of the text; it throws `RangeError` when `now` or `timezone` is not
 * valid, before it reads the text.
 */
export function parseExpenseMessage(text: string, now: Date, timezone: string): ParseResult {
  // Step 1, outside the try block so that a bad time or timezone always throws.
  const today = localDate(now, timezone);
  try {
    return parse(text, today);
  } catch {
    // Unreachable by construction; kept so the function stays total.
    return NOT_EXPENSE;
  }
}

function parse(text: string, today: string): ParseResult {
  // Step 2: empty text, commands and questions.
  if (text.trim() === "" || text.trimStart().startsWith("/") || text.includes("?")) return NOT_EXPENSE;

  // Steps 3 and 4: words, then date phrases taken out.
  const { rest, dates } = findDatePhrases(splitWords(text), today);

  // Step 5: the numbers of each part.
  const parts = splitParts(rest);

  // Step 6: no amount anywhere.
  if (parts.every((part) => part.candidates.length === 0)) return NOT_EXPENSE;

  // Step 7: the dates.
  const dated = checkDates(dates, today);
  if (typeof dated !== "string") return dated;

  // Step 8: join the parts without an amount.
  const groups = joinParts(parts);

  // Step 9: one amount for each group, and its range.
  const chosen = groups.map((group) => chooseAmount(group.candidates));
  if (chosen.some(({ candidate }) => candidate.reading.kind === "out_of_range")) {
    return rejected("amount_out_of_range");
  }

  // Step 10: the number of items.
  if (groups.length > MAX_ITEMS) return rejected("too_many_items");

  // Step 11: the items.
  const items = groups.map((group, index): ParsedItem => {
    const { candidate, flags } = chosen[index] as { candidate: Candidate; flags: Flag[] };
    return {
      amountCentavos: (candidate.reading as Extract<Reading, { kind: "amount" }>).centavos,
      description: describe(group.pieces, candidate.words),
      date: dated,
      flags,
      confidence: flags.length === 0 ? "high" : "low",
    };
  });
  return { kind: "items", items };
}

/** Splits the tokens at separators and `and`, drops empty parts and reads the numbers. */
function splitParts(tokens: Token[]): Part[] {
  const parts: Part[] = [];
  let junction: Token[] = [];
  let words: WordToken[] = [];
  const close = (): void => {
    if (words.length === 0) return;
    parts.push({ junction, words, candidates: readCandidates(words) });
    junction = [];
    words = [];
  };
  for (const token of tokens) {
    if (token.kind === "word") {
      words.push(token);
    } else {
      close();
      junction.push(token);
    }
  }
  close();
  return parts;
}

/**
 * Reads the numbers among the words of one part, with a separate mark word joined to
 * the number after it, and a number followed by `am`, `pm` or `%` left out (Decision 5).
 * A plain number that ordinary chat holds is left out too: one in a digit group, and
 * one after a word such as `at`, `otp` or `ref`. A marked number is always read.
 */
function readCandidates(words: WordToken[]): Candidate[] {
  const candidates: Candidate[] = [];
  const grouped = digitGroups(words);
  for (let index = 0; index < words.length; index++) {
    const word = words[index] as WordToken;
    const next = words[index + 1];

    if (next !== undefined && MARK_WORDS.has(word.bare.toLowerCase())) {
      const alone = readAmount(next.bare);
      const joined = readAmount(word.bare + next.bare);
      if (!(alone.kind !== "not_amount" && alone.marked) && joined.kind !== "not_amount") {
        candidates.push({ reading: joined, words: [word, next] });
        index++;
        continue;
      }
    }

    const reading = readAmount(word.bare);
    if (reading.kind === "not_amount") continue;
    if (!reading.marked && next !== undefined && NOT_AMOUNT_AFTER.has(next.bare.toLowerCase())) continue;
    if (grouped.has(index) || followsReferenceWord(words, index)) continue;
    candidates.push({ reading, words: [word] });
  }
  return candidates;
}

/**
 * The indexes of the plain numbers that stand in a digit group: a row of plain
 * numbers that is three or more long, or that holds one written with a leading zero.
 */
function digitGroups(words: WordToken[]): Set<number> {
  const grouped = new Set<number>();
  for (let start = 0; start < words.length; ) {
    let end = start;
    let leadingZero = false;
    while (end < words.length && PLAIN_NUMBER.test((words[end] as WordToken).bare)) {
      const digits = (words[end] as WordToken).bare;
      if (digits.length > 1 && digits.startsWith("0")) leadingZero = true;
      end++;
    }
    if (end - start >= DIGIT_GROUP_WORDS || leadingZero) {
      for (let index = start; index < end; index++) grouped.add(index);
    }
    start = Math.max(end, start + 1);
  }
  return grouped;
}

/** Whether the word is a plain number after a word of `NOT_AMOUNT_BEFORE`, with at most one linking word between. */
function followsReferenceWord(words: WordToken[], index: number): boolean {
  if (!PLAIN_NUMBER.test((words[index] as WordToken).bare)) return false;
  let before = words[index - 1];
  if (before !== undefined && (LINK_WORDS.has(before.bare.toLowerCase()) || DASHES.test(before.text))) {
    before = words[index - 2];
  }
  return before !== undefined && NOT_AMOUNT_BEFORE.has(before.bare.toLowerCase());
}

/** The rejections that concern the date, in order (Decision 9), or the one date. */
function checkDates(dates: (string | null)[], today: string): string | ParseResult {
  const distinct = new Set(dates.filter((date) => date !== null));
  const count = distinct.size + dates.filter((date) => date === null).length;
  if (count >= 2) return rejected("multiple_dates");
  if (count === 0) return today;
  const [date] = dates;
  if (date === null || date === undefined) return rejected("invalid_date");
  if (date > today) return rejected("future_date");
  return date;
}

/**
 * A part without an amount joins the part after it, or the part before it when it is
 * the last (D11). Punctuation between joined parts is dropped and `and` is kept.
 */
function joinParts(parts: Part[]): Group[] {
  const groups: Group[] = [];
  let pending: Part[] = [];
  for (const part of parts) {
    pending.push(part);
    if (part.candidates.length === 0) continue;
    const group: Group = { pieces: [], candidates: [] };
    for (const joined of pending) append(group, joined);
    groups.push(group);
    pending = [];
  }
  const last = groups[groups.length - 1];
  if (last !== undefined) for (const joined of pending) append(last, joined);
  return groups;
}

function append(group: Group, part: Part): void {
  if (group.pieces.length > 0) group.pieces.push(...part.junction.filter((token) => token.kind === "and"));
  group.pieces.push(...part.words);
  group.candidates.push(...part.candidates);
}

/**
 * Decision 8: the only amount, or the one marked amount. Otherwise the choice is
 * flagged: the last of several marked amounts; or, with no mark, the largest amount in
 * range among those written as money (a thousands separator, a decimal part or `k`)
 * when there is one, else the largest in range, equal amounts going to the last. A
 * quantity is usually smaller than the price, so `grab 180 (2 rides)` is ₱180. With no
 * amount in range, the last one is chosen and the message is rejected.
 */
function chooseAmount(candidates: Candidate[]): { candidate: Candidate; flags: Flag[] } {
  const last = <T>(list: T[]): T => list[list.length - 1] as T;
  if (candidates.length === 1) return { candidate: candidates[0] as Candidate, flags: [] };
  const marked = candidates.filter((candidate) => candidate.reading.marked);
  if (marked.length === 1) return { candidate: marked[0] as Candidate, flags: [] };
  if (marked.length > 0) return { candidate: last(marked), flags: ["ambiguous_amount"] };
  const inRange = candidates.filter((candidate) => candidate.reading.kind === "amount");
  const asMoney = inRange.filter((candidate) => !PLAIN_NUMBER.test(candidate.words[0]?.bare ?? ""));
  const pool = asMoney.length > 0 ? asMoney : inRange;
  return { candidate: pool.length > 0 ? largest(pool) : last(candidates), flags: ["ambiguous_amount"] };
}

/** The candidate with the largest amount; of equal amounts, the last. */
function largest(candidates: Candidate[]): Candidate {
  const centavos = (candidate: Candidate): number =>
    candidate.reading.kind === "amount" ? candidate.reading.centavos : -1;
  return candidates.reduce((best, candidate) => (centavos(candidate) >= centavos(best) ? candidate : best));
}

/** The words not used up by the amount, as typed, joined by single spaces (D29). */
function describe(pieces: Token[], used: WordToken[]): string {
  return pieces
    .filter((piece) => !used.includes(piece as WordToken))
    .map((piece) => piece.text)
    .filter((text) => !DASHES.test(text))
    .join(" ");
}

function rejected(reason: RejectionReason): ParseResult {
  return { kind: "rejected", reason };
}
