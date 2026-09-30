import { describe, expect, it } from "vitest";
import {
  parseExpenseMessage,
  type Flag,
  type ParsedItem,
  type ParseResult,
  type RejectionReason,
} from "../../src/parser";
import { HOUSEHOLD_TZ } from "../helpers/constants";

/** Tuesday 2026-09-29 at 08:00 in Manila. */
const NOW = new Date("2026-09-29T00:00:00.000Z");
const TODAY = "2026-09-29";
const YESTERDAY = "2026-09-28";

const NOT_EXPENSE: ParseResult = { kind: "not_expense" };

function parse(text: string, now: Date = NOW, timezone: string = HOUSEHOLD_TZ): ParseResult {
  return parseExpenseMessage(text, now, timezone);
}

function item(
  amountCentavos: number,
  description: string,
  { date = TODAY, flags = [] }: { date?: string; flags?: Flag[] } = {},
): ParsedItem {
  return { amountCentavos, description, date, flags, confidence: flags.length === 0 ? "high" : "low" };
}

function ambiguous(amountCentavos: number, description: string, date = TODAY): ParsedItem {
  return item(amountCentavos, description, { date, flags: ["ambiguous_amount"] });
}

function items(...list: ParsedItem[]): ParseResult {
  return { kind: "items", items: list };
}

function rejected(reason: RejectionReason): ParseResult {
  return { kind: "rejected", reason };
}

/** `item1 1, item2 2, …` with the given number of parts. */
function numberedParts(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item${index + 1} ${index + 1}`);
}

describe("Parser contract", () => {
  it("One expense", () => {
    expect(parse("lunch 250")).toEqual(items(item(25000, "lunch")));
  });

  it("Same inputs, same result", () => {
    const first = parse("grab 180, dinner for 2 600 kahapon");
    const second = parse("grab 180, dinner for 2 600 kahapon");
    expect(first).toEqual(second);
    expect(first).toEqual(items(item(18000, "grab", { date: YESTERDAY }), ambiguous(60000, "dinner for 2", YESTERDAY)));
  });

  it.each([
    ["empty", ""],
    ["white space only", "  \t \n  "],
  ])("Empty message: %s", (_label, text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it.each([
    ["only emoji", "🍔🍟🥤"],
    ["only control characters", "\u0000\u0001\u0007\u001b"],
    ["half of a surrogate pair", "\ud83c"],
    ["4,096 digits", "1".repeat(4096)],
    ["4,096 commas", ",".repeat(4096)],
  ])("Unusual text does not throw: %s", (_label, text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it("Longest message", () => {
    const text = "a 1, ".repeat(820).slice(0, 4096);
    expect(text).toHaveLength(4096);
    expect(parse(text)).toEqual(rejected("too_many_items"));
  });

  it.each([["lunch 250"], [""], ["ok thanks"], ["lunch 250?"]])(
    "Timezone is not valid: %j",
    (text) => {
      expect(() => parse(text, NOW, "Mars/Olympus")).toThrow(RangeError);
    },
  );

  it.each([["lunch 250"], [""], ["ok thanks"], ["lunch 250?"]])("Time is not valid: %j", (text) => {
    expect(() => parse(text, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("Amount formats", () => {
  it("Whole number", () => {
    expect(parse("lunch 250")).toEqual(items(item(25000, "lunch")));
  });

  it("Two decimal places", () => {
    expect(parse("lunch 250.50")).toEqual(items(item(25050, "lunch")));
  });

  it("One decimal place", () => {
    expect(parse("lunch 250.5")).toEqual(items(item(25050, "lunch")));
  });

  it("Thousands separator with decimals", () => {
    expect(parse("groceries 1,500.50")).toEqual(items(item(150050, "groceries")));
  });

  it("Suffix k", () => {
    expect(parse("grab 1.5k")).toEqual(items(item(150000, "grab")));
  });

  it("Suffix K in capitals", () => {
    expect(parse("grab 2K")).toEqual(items(item(200000, "grab")));
  });

  it("Peso sign", () => {
    expect(parse("₱80 coffee")).toEqual(items(item(8000, "coffee")));
  });

  it.each([
    ["one space", "₱ 250 lunch"],
    ["three spaces", "₱   250 lunch"],
  ])("Peso sign followed by spaces: %s", (_label, text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch")));
  });

  it.each([["P250 lunch"], ["p250 lunch"]])("Letter P joined to the number: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch")));
  });

  it("Letter P on its own is a word", () => {
    expect(parse("P 250 lunch")).toEqual(items(item(25000, "P lunch")));
  });

  it.each([["php 250 lunch"], ["PHP250 lunch"], ["Php 250 lunch"]])("The mark php: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch")));
  });

  it("Mark and suffix together", () => {
    expect(parse("₱1.5k grab")).toEqual(items(item(150000, "grab")));
  });

  it("Amount before the description", () => {
    expect(parse("250 lunch jollibee")).toEqual(items(item(25000, "lunch jollibee")));
  });

  it("Amount alone", () => {
    expect(parse("250")).toEqual(items(item(25000, "")));
  });

  it.each([["lunch 250."], ["lunch 250!"], ["lunch (250)"]])("Punctuation around the number: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch")));
  });

  it("No rounding error", () => {
    expect(parse("candy 1.15")).toEqual(items(item(115, "candy")));
  });

  it("Currency word after the number", () => {
    expect(parse("lunch 250 pesos")).toEqual(items(item(25000, "lunch pesos")));
  });
});

describe("Amount range", () => {
  it("Smallest amount", () => {
    expect(parse("candy 0.01")).toEqual(items(item(1, "candy")));
  });

  it("Largest amount", () => {
    expect(parse("lot 9,999,999.99")).toEqual(items(item(999999999, "lot")));
  });

  it("Zero", () => {
    expect(parse("lunch 0")).toEqual(rejected("amount_out_of_range"));
  });

  it("Ten million", () => {
    expect(parse("condo 10,000,000")).toEqual(rejected("amount_out_of_range"));
  });

  it("Above ten million", () => {
    expect(parse("condo 25,000,000")).toEqual(rejected("amount_out_of_range"));
  });

  it("Negative amount", () => {
    expect(parse("refund -250")).toEqual(rejected("amount_out_of_range"));
  });

  it("One amount out of range among several items", () => {
    expect(parse("lunch 250, condo 25,000,000")).toEqual(rejected("amount_out_of_range"));
  });

  it("A number that was not chosen is not checked", () => {
    expect(parse("dinner for 0 600")).toEqual(items(ambiguous(60000, "dinner for 0")));
  });
});

describe("Numbers that are not amounts", () => {
  it("Time joined to am or pm", () => {
    expect(parse("see you at 5pm")).toEqual(NOT_EXPENSE);
  });

  it.each([["see you at 5 pm"], ["see you at 5 PM"]])("Time with a space: %s", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it.each([["meet 10:30"], ["meet 10:30am"]])("Clock time: %s", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it("Ordinal", () => {
    expect(parse("pay meralco on the 15th")).toEqual(NOT_EXPENSE);
  });

  it.each([["sale 20% off"], ["sale 20 % off"]])("Percentage: %s", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it("Eight digits", () => {
    expect(parse("gcash ref 12345678")).toEqual(NOT_EXPENSE);
  });

  it("Phone number", () => {
    expect(parse("call 09171234567")).toEqual(NOT_EXPENSE);
  });

  it("Seven digits is an amount", () => {
    expect(parse("car 1234567")).toEqual(items(item(123456700, "car")));
  });

  it("Three decimal places", () => {
    expect(parse("gas 45.678")).toEqual(NOT_EXPENSE);
  });

  it.each([["lunch 250.500"], ["groceries 1.500"]])("Extra decimal places that are zeros: %s", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it.each<[string, number]>([
    ["grab 1.2345k", 123450],
    ["grab 1.50000k", 150000],
  ])("Suffix k with up to five decimal places: %s", (text, centavos) => {
    expect(parse(text)).toEqual(items(item(centavos, "grab")));
  });

  it.each([["grab 1.234567k"], ["grab 1.500000k"]])("Suffix k with six decimal places: %s", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it("Full-width digits", () => {
    expect(parse("lunch ２５０")).toEqual(NOT_EXPENSE);
  });

  it("Number joined to a unit", () => {
    expect(parse("rice 5kg 300")).toEqual(items(item(30000, "rice 5kg")));
  });

  it("Fraction", () => {
    expect(parse("1/2 kilo pork 180")).toEqual(items(item(18000, "1/2 kilo pork")));
  });

  it("Time next to an amount", () => {
    expect(parse("lunch 250 at 5pm")).toEqual(items(item(25000, "lunch at 5pm")));
  });

  it("Link", () => {
    expect(parse("https://shop.example/item/12345 500")).toEqual(
      items(item(50000, "https://shop.example/item/12345")),
    );
  });
});

describe("Several numbers in one item", () => {
  it("Two numbers without a mark", () => {
    expect(parse("dinner for 2 600")).toEqual(items(ambiguous(60000, "dinner for 2")));
  });

  it("Quantity before the amount", () => {
    expect(parse("2 shirts 1500")).toEqual(items(ambiguous(150000, "2 shirts")));
  });

  it("Marked amount comes first", () => {
    expect(parse("₱600 dinner for 2")).toEqual(items(item(60000, "dinner for 2")));
  });

  it.each([["dinner for 2 ₱600"], ["dinner for 2 php 600"]])("Marked amount comes last: %s", (text) => {
    expect(parse(text)).toEqual(items(item(60000, "dinner for 2")));
  });

  it("Two marked amounts", () => {
    expect(parse("₱100 ₱200 snacks")).toEqual(items(ambiguous(20000, "₱100 snacks")));
  });

  it("The same number twice", () => {
    expect(parse("250 lunch 250")).toEqual(items(ambiguous(25000, "250 lunch")));
  });
});

describe("Several expenses in one message", () => {
  const GRAB_AND_LUNCH = items(item(18000, "grab"), item(25000, "lunch"));

  it("Comma", () => {
    expect(parse("grab 180, groceries 2340 gcash")).toEqual(
      items(item(18000, "grab"), item(234000, "groceries gcash")),
    );
  });

  it("New line", () => {
    expect(parse("grab 180\nlunch 250")).toEqual(GRAB_AND_LUNCH);
  });

  it("Semicolon", () => {
    expect(parse("grab 180; lunch 250")).toEqual(GRAB_AND_LUNCH);
  });

  it.each([["grab 180 and lunch 250"], ["grab 180 AND lunch 250"]])("The word and: %s", (text) => {
    expect(parse(text)).toEqual(GRAB_AND_LUNCH);
  });

  it("Plus sign", () => {
    expect(parse("grab 180 + lunch 250")).toEqual(GRAB_AND_LUNCH);
  });

  it("Separator without spaces", () => {
    expect(parse("grab 180,lunch 250")).toEqual(GRAB_AND_LUNCH);
  });

  it("Comma inside a number", () => {
    expect(parse("groceries 1,500, grab 180")).toEqual(items(item(150000, "groceries"), item(18000, "grab")));
  });

  it("Comma followed by fewer than three digits", () => {
    expect(parse("snacks 50,75")).toEqual(items(item(5000, "snacks"), item(7500, "")));
  });

  it("The word and inside a description", () => {
    expect(parse("mac and cheese 250")).toEqual(items(item(25000, "mac and cheese")));
  });

  it("Comma inside a description", () => {
    expect(parse("lunch, coffee 330")).toEqual(items(item(33000, "lunch coffee")));
  });

  it("Last part without an amount", () => {
    expect(parse("groceries 2340, gcash")).toEqual(items(item(234000, "groceries gcash")));
  });

  it("Middle part without an amount", () => {
    expect(parse("grab 180, lunch, coffee 330")).toEqual(items(item(18000, "grab"), item(33000, "lunch coffee")));
  });

  it("Several parts in a row without an amount", () => {
    expect(parse("rice, eggs, milk 450")).toEqual(items(item(45000, "rice eggs milk")));
  });

  it("Empty parts", () => {
    expect(parse("lunch 250,, grab 180,")).toEqual(items(item(25000, "lunch"), item(18000, "grab")));
  });

  it("Flags belong to one item", () => {
    expect(parse("dinner for 2 600, grab 180")).toEqual(items(ambiguous(60000, "dinner for 2"), item(18000, "grab")));
  });

  it("Ten items", () => {
    const expected = Array.from({ length: 10 }, (_, index) => item((index + 1) * 100, `item${index + 1}`));
    expect(parse(numberedParts(10).join(", "))).toEqual(items(...expected));
  });

  it("Eleven items", () => {
    expect(parse(numberedParts(11).join(", "))).toEqual(rejected("too_many_items"));
  });
});

describe("Entry date", () => {
  it("No date named", () => {
    expect(parse("lunch 250")).toEqual(items(item(25000, "lunch", { date: TODAY })));
  });

  it("Last second of the day", () => {
    expect(parse("lunch 250", new Date("2026-09-29T15:59:59Z"))).toEqual(
      items(item(25000, "lunch", { date: "2026-09-29" })),
    );
  });

  it("First second of the next day", () => {
    expect(parse("lunch 250", new Date("2026-09-29T16:00:00Z"))).toEqual(
      items(item(25000, "lunch", { date: "2026-09-30" })),
    );
  });

  it("Another timezone", () => {
    expect(parse("lunch 250", NOW, "America/Los_Angeles")).toEqual(
      items(item(25000, "lunch", { date: "2026-09-28" })),
    );
  });

  it.each([["today lunch 250"], ["ngayon lunch 250"], ["kanina lunch 250"]])("Words for today: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch", { date: TODAY })));
  });

  it.each([["yesterday lunch 250"], ["kahapon lunch 250"], ["kagabi lunch 250"]])(
    "Words for yesterday: %s",
    (text) => {
      expect(parse(text)).toEqual(items(item(25000, "lunch", { date: YESTERDAY })));
    },
  );

  it("Days ago", () => {
    expect(parse("3 days ago lunch 250")).toEqual(items(item(25000, "lunch", { date: "2026-09-26" })));
  });

  it("One day ago", () => {
    expect(parse("1 day ago lunch 250")).toEqual(items(item(25000, "lunch", { date: YESTERDAY })));
  });

  it("Days ago across a month boundary", () => {
    expect(parse("30 days ago lunch 250")).toEqual(items(item(25000, "lunch", { date: "2026-08-30" })));
  });

  it("Largest number of days ago", () => {
    expect(parse("9999 days ago lunch 250")).toEqual(items(item(25000, "lunch", { date: "1999-05-15" })));
  });

  it("Zero days ago is not a date", () => {
    expect(parse("0 days ago lunch 250")).toEqual(items(ambiguous(25000, "0 days ago lunch")));
  });

  it("More days ago than the limit is not a date", () => {
    expect(parse("10000 days ago lunch 250")).toEqual(items(ambiguous(25000, "10000 days ago lunch")));
  });

  it("Month then day", () => {
    expect(parse("sep 27 meralco 3200")).toEqual(items(item(320000, "meralco", { date: "2026-09-27" })));
  });

  it("Day then month", () => {
    expect(parse("27 sep meralco 3200")).toEqual(items(item(320000, "meralco", { date: "2026-09-27" })));
  });

  it.each([["september 27 meralco 3200"], ["Sept 27 meralco 3200"]])("Other spellings of the month: %s", (text) => {
    expect(parse(text)).toEqual(items(item(320000, "meralco", { date: "2026-09-27" })));
  });

  it("Date with a year", () => {
    expect(parse("2026-09-27 meralco 3200")).toEqual(items(item(320000, "meralco", { date: "2026-09-27" })));
  });

  it("Date after the amount", () => {
    expect(parse("lunch 250 kahapon")).toEqual(items(item(25000, "lunch", { date: YESTERDAY })));
  });

  it.each([["KAHAPON lunch 250"], ["SEP 28 lunch 250"]])("Capital letters: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch", { date: YESTERDAY })));
  });

  it.each([["kahapon: lunch 250"], ["(kahapon) lunch 250"]])("Punctuation around a date word: %s", (text) => {
    expect(parse(text)).toEqual(items(item(25000, "lunch", { date: YESTERDAY })));
  });

  it("One date for every item", () => {
    expect(parse("kahapon grab 180, lunch 250")).toEqual(
      items(item(18000, "grab", { date: YESTERDAY }), item(25000, "lunch", { date: YESTERDAY })),
    );
  });

  it("Yesterday across a year boundary", () => {
    expect(parse("kahapon lunch 250", new Date("2026-12-31T16:30:00Z"))).toEqual(
      items(item(25000, "lunch", { date: "2026-12-31" })),
    );
  });

  it("Month name without a day number", () => {
    expect(parse("jan 500")).toEqual(items(item(50000, "jan", { date: TODAY })));
  });

  it("Day number on both sides of a month name", () => {
    expect(parse("12 may 13")).toEqual(items(item(1300, "", { date: "2026-05-12" })));
  });

  it("Month name takes the only number", () => {
    expect(parse("jun 20")).toEqual(NOT_EXPENSE);
  });
});

describe("Date without a year", () => {
  it("Nearest date is in the previous year", () => {
    expect(parse("dec 30 gift 500", new Date("2027-01-02T00:00:00Z"))).toEqual(
      items(item(50000, "gift", { date: "2026-12-30" })),
    );
  });

  it("Nearest date is today", () => {
    expect(parse("sep 29 lunch 250")).toEqual(items(item(25000, "lunch", { date: "2026-09-29" })));
  });

  it("Nearest date is in the future", () => {
    expect(parse("oct 15 rent 12000")).toEqual(rejected("future_date"));
  });

  it("Leap day in the previous year", () => {
    expect(parse("feb 29 lunch 250", new Date("2025-03-05T00:00:00Z"))).toEqual(
      items(item(25000, "lunch", { date: "2024-02-29" })),
    );
  });

  it("Leap day in neither year", () => {
    expect(parse("feb 29 lunch 250")).toEqual(rejected("invalid_date"));
  });

  it("Tie goes to the past", () => {
    expect(parse("dec 31 gift 500", new Date("2028-07-01T00:00:00Z"))).toEqual(
      items(item(50000, "gift", { date: "2027-12-31" })),
    );
  });
});

describe("Date rejections", () => {
  it("Tomorrow", () => {
    expect(parse("2026-09-30 lunch 250")).toEqual(rejected("future_date"));
  });

  it("Day that does not exist", () => {
    expect(parse("sep 31 lunch 250")).toEqual(rejected("invalid_date"));
  });

  it.each([["2026-02-30 lunch 250"], ["2026-13-01 lunch 250"]])("Date with a year that does not exist: %s", (text) => {
    expect(parse(text)).toEqual(rejected("invalid_date"));
  });

  it("Two different dates", () => {
    expect(parse("kahapon lunch 250, sep 20 grab 180")).toEqual(rejected("multiple_dates"));
  });

  it("The same date named twice", () => {
    expect(parse("kahapon lunch 250, sep 28 grab 180")).toEqual(
      items(item(25000, "lunch", { date: YESTERDAY }), item(18000, "grab", { date: YESTERDAY })),
    );
  });

  it("A real date and one that does not exist", () => {
    expect(parse("kahapon lunch 250, sep 31 grab 180")).toEqual(rejected("multiple_dates"));
  });

  it("Date far in the past", () => {
    expect(parse("2020-01-01 lunch 250")).toEqual(items(item(25000, "lunch", { date: "2020-01-01" })));
  });

  it("Future date without an amount", () => {
    expect(parse("see you oct 15")).toEqual(NOT_EXPENSE);
  });

  it("Invalid date without an amount", () => {
    expect(parse("sep 31")).toEqual(NOT_EXPENSE);
  });
});

describe("Order of rejection reasons", () => {
  it("Future date and an amount out of range", () => {
    expect(parse("oct 15 condo 25,000,000")).toEqual(rejected("future_date"));
  });

  it("Amount out of range and too many items", () => {
    const parts = numberedParts(11);
    parts[5] = "condo 25,000,000";
    expect(parse(parts.join(", "))).toEqual(rejected("amount_out_of_range"));
  });
});

describe("Questions and commands", () => {
  it("Question", () => {
    expect(parse("magkano na gastos natin?")).toEqual(NOT_EXPENSE);
  });

  it("Question with an amount", () => {
    expect(parse("lunch 250?")).toEqual(NOT_EXPENSE);
  });

  it("Question mark in the middle", () => {
    expect(parse("lunch 250 ok? thanks")).toEqual(NOT_EXPENSE);
  });

  it("Command", () => {
    expect(parse("/week")).toEqual(NOT_EXPENSE);
  });

  it.each([["/undo 250"], ["  /undo 250"], ["\n\t/undo 250"]])("Command with a number: %j", (text) => {
    expect(parse(text)).toEqual(NOT_EXPENSE);
  });

  it("Slash inside the message", () => {
    expect(parse("lunch w/ fries 250")).toEqual(items(item(25000, "lunch w/ fries")));
  });

  it("Chat without a number", () => {
    expect(parse("ok thanks")).toEqual(NOT_EXPENSE);
  });
});

describe("Item description", () => {
  it("Original casing", () => {
    expect(parse("Lunch Jollibee 250")).toEqual(items(item(25000, "Lunch Jollibee")));
  });

  it("Extra white space", () => {
    expect(parse("  lunch   jollibee\t250  ")).toEqual(items(item(25000, "lunch jollibee")));
  });

  it("Payment word stays", () => {
    expect(parse("groceries 2340 gcash")).toEqual(items(item(234000, "groceries gcash")));
  });

  it("Hyphen between description and amount", () => {
    expect(parse("lunch - 250")).toEqual(items(item(25000, "lunch")));
  });

  it("Punctuation joined to a word stays", () => {
    expect(parse("lunch: 250")).toEqual(items(item(25000, "lunch:")));
  });

  it("Brackets in the description", () => {
    expect(parse("lunch (jollibee) 250")).toEqual(items(item(25000, "lunch (jollibee)")));
  });

  it("Characters that a reply would escape", () => {
    expect(parse("a<b & c 100")).toEqual(items(item(10000, "a<b & c")));
  });

  it("Emoji", () => {
    expect(parse("🍔 burger 250")).toEqual(items(item(25000, "🍔 burger")));
  });

  it("The word and is kept when parts are joined", () => {
    expect(parse("groceries 2340 and gcash")).toEqual(items(item(234000, "groceries and gcash")));
  });
});
