import { describe, expect, it } from "vitest";
import { readAmount, type AmountReading } from "../../src/parser/amounts";

function amount(centavos: number, marked = false): AmountReading {
  return { kind: "amount", centavos, marked };
}

function outOfRange(marked = false): AmountReading {
  return { kind: "out_of_range", marked };
}

const NOT_AMOUNT: AmountReading = { kind: "not_amount" };

describe("readAmount: amounts", () => {
  it.each<[string, string, AmountReading]>([
    ["a whole number", "250", amount(25000)],
    ["one decimal place", "250.5", amount(25050)],
    ["two decimal places", "250.50", amount(25050)],
    ["a value that floating point rounds", "1.15", amount(115)],
    ["the smallest amount", "0.01", amount(1)],
    ["a thousands separator", "1,500", amount(150000)],
    ["a thousands separator with decimals", "1,500.50", amount(150050)],
    ["the largest amount", "9,999,999.99", amount(999999999)],
    ["seven plain digits", "1234567", amount(123456700)],
    ["the suffix k", "1.5k", amount(150000)],
    ["the suffix K", "1.5K", amount(150000)],
    ["the suffix k with trailing zeros", "1.50000k", amount(150000)],
    ["the suffix k with four decimal places", "1.2345k", amount(123450)],
    ["the peso sign", "₱250", amount(25000, true)],
    ["the letter P", "P250", amount(25000, true)],
    ["the letter p", "p250", amount(25000, true)],
    ["the mark php", "php250", amount(25000, true)],
    ["the mark PHP", "PHP250", amount(25000, true)],
    ["a mark and the suffix k", "₱1.5k", amount(150000, true)],
  ])("reads %s: %s", (_label, word, reading) => {
    expect(readAmount(word)).toEqual(reading);
  });
});

describe("readAmount: out of range", () => {
  it.each<[string, string, AmountReading]>([
    ["zero", "0", outOfRange()],
    ["zero with decimals", "0.00", outOfRange()],
    ["a negative number", "-250", outOfRange()],
    ["a negative marked number", "-₱250", outOfRange(true)],
    ["ten million", "10,000,000", outOfRange()],
    ["twenty-five million", "25,000,000", outOfRange()],
    ["ten million with the suffix k", "10000k", outOfRange()],
    ["eight whole digits with decimals", "12345678.50", outOfRange()],
    ["eight marked digits", "₱12345678", outOfRange(true)],
  ])("reads %s: %s", (_label, word, reading) => {
    expect(readAmount(word)).toEqual(reading);
  });
});

describe("readAmount: not an amount", () => {
  it.each<[string, string]>([
    ["eight plain digits", "12345678"],
    ["a phone number", "09171234567"],
    ["leading zeros", "007"],
    ["a phone prefix", "0917"],
    ["a number with a plus sign", "+1"],
    ["three decimal places", "45.678"],
    ["three decimal places below one", "0.001"],
    ["three decimal places ending in zeros", "250.500"],
    ["a period as a thousands separator", "1.500"],
    ["the suffix k with six decimal places", "1.234567k"],
    ["the suffix k with six decimal places ending in zeros", "1.500000k"],
    ["a time with pm", "5pm"],
    ["a clock time", "10:30"],
    ["an ordinal", "15th"],
    ["a percentage", "20%"],
    ["a unit", "5kg"],
    ["a multiplier", "x2"],
    ["a fraction", "1/2"],
    ["a tag", "#123"],
    ["a group of two digits", "1,50"],
    ["groups of two digits", "12,34,567"],
    ["a group of four digits", "1,5000"],
    ["no whole part", ".5"],
    ["a trailing decimal point", "5."],
    ["an exponent", "1e3"],
    ["hexadecimal", "0x10"],
    ["full-width digits", "２５０"],
    ["the empty text", ""],
    ["the suffix alone", "k"],
    ["the peso sign alone", "₱"],
    ["the mark php alone", "php"],
    ["a minus sign alone", "-"],
  ])("rejects %s: %s", (_label, word) => {
    expect(readAmount(word)).toEqual(NOT_AMOUNT);
  });
});
