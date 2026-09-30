import { isRealDate, nearestDate, shiftDate } from "./dates";
import type { Token } from "./words";

export interface DatePhrases {
  /** The tokens that are not part of a date phrase, in order. */
  rest: Token[];
  /** One entry for each phrase, in order. `null` is not a real date. */
  dates: (string | null)[];
}

const TODAY_WORDS = new Set(["today", "ngayon", "kanina"]);
const YESTERDAY_WORDS = new Set(["yesterday", "kahapon", "kagabi"]);
const DAY_WORDS = new Set(["day", "days"]);

const MONTHS = new Map<string, number>([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

const DAYS_AGO = /^[0-9]{1,4}$/;
const DAY_NUMBER = /^[0-9]{1,2}$/;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * Finds the date phrases among the tokens and takes their words out (design
 * Decision 6). The rules are tried in order at each word, from left to right, and
 * the words of one phrase follow each other with no separating token between them.
 */
export function findDatePhrases(tokens: Token[], today: string): DatePhrases {
  const rest: Token[] = [];
  const dates: (string | null)[] = [];
  // The lower-cased bare form of each token, or null for a separating token.
  const words = tokens.map((token) => (token.kind === "word" ? token.bare.toLowerCase() : null));

  for (let index = 0; index < tokens.length; ) {
    const phrase = matchPhrase(words, index, today);
    if (phrase === undefined) {
      rest.push(tokens[index] as Token);
      index++;
    } else {
      dates.push(phrase.date);
      index += phrase.length;
    }
  }
  return { rest, dates };
}

function matchPhrase(
  words: (string | null)[],
  index: number,
  today: string,
): { date: string | null; length: number } | undefined {
  const [first, second, third] = [words[index], words[index + 1], words[index + 2]];
  if (first === null || first === undefined) return undefined;

  // Rules 1 and 2: one word for today or yesterday.
  if (TODAY_WORDS.has(first)) return { date: today, length: 1 };
  if (YESTERDAY_WORDS.has(first)) return { date: shiftDate(today, -1), length: 1 };

  // Rule 3: N day(s) ago, with N from 1 to 9999.
  if (DAYS_AGO.test(first) && Number(first) >= 1 && DAY_WORDS.has(second ?? "") && third === "ago") {
    return { date: shiftDate(today, -Number(first)), length: 3 };
  }

  // Rule 4: a day number, then a month name.
  const dayFirst = dayNumber(first);
  const monthSecond = MONTHS.get(second ?? "");
  if (dayFirst !== undefined && monthSecond !== undefined) {
    return { date: nearestDate(monthSecond, dayFirst, today), length: 2 };
  }

  // Rule 5: a month name, then a day number.
  const monthFirst = MONTHS.get(first);
  const daySecond = dayNumber(second);
  if (monthFirst !== undefined && daySecond !== undefined) {
    return { date: nearestDate(monthFirst, daySecond, today), length: 2 };
  }

  // Rule 6: YYYY-MM-DD.
  const iso = ISO_DATE.exec(first);
  if (iso !== null) {
    const real = isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return { date: real ? first : null, length: 1 };
  }

  return undefined;
}

function dayNumber(word: string | null | undefined): number | undefined {
  if (word === null || word === undefined || !DAY_NUMBER.test(word)) return undefined;
  const day = Number(word);
  return day >= 1 && day <= 31 ? day : undefined;
}
