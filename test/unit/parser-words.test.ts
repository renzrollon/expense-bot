import { describe, expect, it } from "vitest";
import { splitWords, type Token } from "../../src/parser/words";

function word(text: string, bare = text): Token {
  return { kind: "word", text, bare };
}

function sep(text: "\n" | "," | ";" | "+"): Token {
  return { kind: "separator", text };
}

function and(text: string): Token {
  return { kind: "and", text };
}

describe("splitWords", () => {
  it.each<[string, string, Token[]]>([
    ["one space", "lunch 250", [word("lunch"), word("250")]],
    ["spaces and a tab", "  lunch\t250  ", [word("lunch"), word("250")]],
    ["a non-breaking space", "lunch 250", [word("lunch"), word("250")]],
    ["the empty text", "", []],
    ["a comma", "grab 180, lunch 250", [word("grab"), word("180"), sep(","), word("lunch"), word("250")]],
    ["a comma without a space", "grab 180,lunch 250", [word("grab"), word("180"), sep(","), word("lunch"), word("250")]],
    ["a grouped number with decimals", "groceries 1,500.50", [word("groceries"), word("1,500.50")]],
    ["a grouped number before a comma", "₱1,500, grab 180", [word("₱1,500"), sep(","), word("grab"), word("180")]],
    ["two groups", "25,000,000", [word("25,000,000")]],
    ["a comma before two digits", "snacks 50,75", [word("snacks"), word("50"), sep(","), word("75")]],
    ["a comma before four digits", "lunch 1,5000", [word("lunch"), word("1"), sep(","), word("5000")]],
    ["a comma after four digits", "1234,567", [word("1234"), sep(","), word("567")]],
    ["a semicolon and a plus sign", "a;b+c", [word("a"), sep(";"), word("b"), sep("+"), word("c")]],
    ["a plus sign between spaces", "grab 180 + lunch 250", [word("grab"), word("180"), sep("+"), word("lunch"), word("250")]],
    ["a plus sign after a digit", "180+250", [word("180"), sep("+"), word("250")]],
    ["a plus sign before a letter", "a +b", [word("a"), sep("+"), word("b")]],
    ["a plus sign joined to a number", "+1", [word("+1")]],
    ["a plus sign joined to a number inside the text", "grab 180 +50 tip", [word("grab"), word("180"), word("+50"), word("tip")]],
    ["a country code", "+63 917", [word("+63"), word("917")]],
    ["a new line", "a\nb", [word("a"), sep("\n"), word("b")]],
    ["a carriage return and a new line", "a\r\nb", [word("a"), sep("\n"), word("b")]],
    ["two commas", ",,", [sep(","), sep(",")]],
    ["the word and", "mac and cheese", [word("mac"), and("and"), word("cheese")]],
    ["the word AND", "Mac AND cheese", [word("Mac"), and("AND"), word("cheese")]],
    ["words that contain and", "brand new sandals", [word("brand"), word("new"), word("sandals")]],
    ["brackets and a period", "lunch (250).", [word("lunch"), word("(250).", "250")]],
    ["a colon", "kahapon: lunch", [word("kahapon:", "kahapon"), word("lunch")]],
    ["a hyphen", "lunch - 250", [word("lunch"), word("-"), word("250")]],
    ["a colon alone", ":", [word(":", "")]],
    ["a clock time", "10:30", [word("10:30")]],
  ])("splits %s", (_label, text, tokens) => {
    expect(splitWords(text)).toEqual(tokens);
  });
});
