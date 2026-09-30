import { describe, expect, it } from "vitest";
import { findDatePhrases, type DatePhrases } from "../../src/parser/phrases";
import type { Token } from "../../src/parser/words";

const TODAY = "2026-09-29";

/** A word token, built by hand so that these tests do not depend on splitWords. */
function w(text: string, bare = text): Token {
  return { kind: "word", text, bare };
}

/** A separator token. */
function s(text: "\n" | "," | ";" | "+"): Token {
  return { kind: "separator", text };
}

/** Words from a text with single spaces, each with its bare form equal to its text. */
function words(text: string): Token[] {
  return text.split(" ").map((part) => w(part));
}

function result(dates: (string | null)[], rest: Token[]): DatePhrases {
  return { rest, dates };
}

describe("findDatePhrases", () => {
  it.each<[string, Token[], DatePhrases]>([
    ["no phrase", words("lunch 250"), result([], words("lunch 250"))],
    ["today", words("today lunch"), result(["2026-09-29"], words("lunch"))],
    ["ngayon", words("ngayon lunch"), result(["2026-09-29"], words("lunch"))],
    ["kanina", words("kanina lunch"), result(["2026-09-29"], words("lunch"))],
    ["yesterday", words("yesterday lunch"), result(["2026-09-28"], words("lunch"))],
    ["kahapon", words("kahapon lunch"), result(["2026-09-28"], words("lunch"))],
    ["kagabi", words("kagabi lunch"), result(["2026-09-28"], words("lunch"))],
    ["KAHAPON", words("KAHAPON lunch"), result(["2026-09-28"], words("lunch"))],
    ["kahapon in brackets", [w("(kahapon)", "kahapon"), w("lunch")], result(["2026-09-28"], words("lunch"))],
    ["kahapon with a colon", [w("kahapon:", "kahapon"), w("lunch")], result(["2026-09-28"], words("lunch"))],
    ["a phrase at the end", words("lunch 250 kahapon"), result(["2026-09-28"], words("lunch 250"))],
    ["3 days ago", words("3 days ago lunch"), result(["2026-09-26"], words("lunch"))],
    ["1 day ago", words("1 day ago lunch"), result(["2026-09-28"], words("lunch"))],
    ["9999 days ago", words("9999 days ago lunch"), result(["1999-05-15"], words("lunch"))],
    ["0 days ago", words("0 days ago lunch"), result([], words("0 days ago lunch"))],
    ["10000 days ago", words("10000 days ago lunch"), result([], words("10000 days ago lunch"))],
    ["days without ago", words("3 days lunch"), result([], words("3 days lunch"))],
    ["month then day", words("sep 27 meralco"), result(["2026-09-27"], words("meralco"))],
    ["day then month", words("27 sep meralco"), result(["2026-09-27"], words("meralco"))],
    ["the full month name", words("september 27"), result(["2026-09-27"], [])],
    ["Sept", words("Sept 27"), result(["2026-09-27"], [])],
    ["SEP", words("SEP 27"), result(["2026-09-27"], [])],
    ["a day with a period", [w("sep"), w("27.", "27")], result(["2026-09-27"], [])],
    ["a day with a leading zero", words("sep 07"), result(["2026-09-07"], [])],
    ["a day number on both sides", words("12 may 13"), result(["2026-05-12"], words("13"))],
    ["a future date", words("oct 15 rent"), result(["2026-10-15"], words("rent"))],
    ["a month with an amount", words("jan 500"), result([], words("jan 500"))],
    ["day 32", words("sep 32"), result([], words("sep 32"))],
    ["day 0", words("sep 0"), result([], words("sep 0"))],
    ["a marked number before a month", words("₱27 sep"), result([], words("₱27 sep"))],
    ["an ordinal day", words("sep 27th"), result([], words("sep 27th"))],
    ["a separator between month and day", [w("sep"), s(","), w("27")], result([], [w("sep"), s(","), w("27")])],
    ["sep 31", words("sep 31 lunch"), result([null], words("lunch"))],
    ["feb 29 in a common year", words("feb 29 lunch"), result([null], words("lunch"))],
    ["a date with a year", words("2026-09-27 lunch"), result(["2026-09-27"], words("lunch"))],
    ["a day that does not exist", words("2026-02-30 lunch"), result([null], words("lunch"))],
    ["a month that does not exist", words("2026-13-01 lunch"), result([null], words("lunch"))],
    ["a date without padding", words("2026-9-27 lunch"), result([], words("2026-9-27 lunch"))],
    [
      "two different dates",
      [...words("kahapon lunch"), s(","), ...words("sep 20 grab")],
      result(["2026-09-28", "2026-09-20"], [w("lunch"), s(","), w("grab")]),
    ],
    [
      "the same date twice",
      [...words("kahapon lunch"), s(","), ...words("sep 28 grab")],
      result(["2026-09-28", "2026-09-28"], [w("lunch"), s(","), w("grab")]),
    ],
  ])("finds %s", (_label, tokens, expected) => {
    expect(findDatePhrases(tokens, TODAY)).toEqual(expected);
  });
});
