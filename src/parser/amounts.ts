export type AmountReading =
  | { kind: "amount"; centavos: number; marked: boolean }
  | { kind: "out_of_range"; marked: boolean }
  | { kind: "not_amount" };

/**
 * An optional minus sign, an optional mark, digits that are plain or grouped by
 * thousands, an optional decimal part and an optional suffix k. Anchored to one
 * word, and no repetition sits inside another.
 */
const SHAPE = /^(-?)(₱|php|p)?([0-9]{1,3}(?:,[0-9][0-9][0-9])+|[0-9]+)(?:\.([0-9]+))?(k?)$/i;

const ONLY_DIGITS = /^[0-9]+$/;

/** Plain digit runs this long are references or phone numbers, not amounts (D10). */
const MAX_PLAIN_DIGITS = 7;

/** A whole part this long is 10,000,000 pesos or more (D32). */
const MAX_WHOLE_DIGITS = 7;

const NOT_AMOUNT: AmountReading = { kind: "not_amount" };

/**
 * Reads the bare form of one word as an amount in whole centavos (design Decision 5).
 * The checks run in a fixed order, and the conversion works on digits, never on
 * floating-point values.
 */
export function readAmount(word: string): AmountReading {
  // 1. The shape.
  const match = SHAPE.exec(word);
  if (match === null) return NOT_AMOUNT;
  const [, minus, mark, grouped = "", decimals = "", suffix] = match;
  const marked = mark !== undefined;

  // 2. A long run of plain digits, or one written with a leading zero, such as `0917`.
  if (ONLY_DIGITS.test(word) && (word.length > MAX_PLAIN_DIGITS || (word.length > 1 && word.startsWith("0")))) {
    return NOT_AMOUNT;
  }

  // 3. The suffix k moves the decimal point 3 places; decimals are counted as written.
  let whole = grouped.replaceAll(",", "");
  let fraction = decimals;
  if (suffix !== "") {
    whole += fraction.slice(0, 3).padEnd(3, "0");
    fraction = fraction.slice(3);
  }
  if (fraction.length > 2) return NOT_AMOUNT;

  // 4. A minus sign.
  if (minus !== "") return { kind: "out_of_range", marked };

  // 5. Ten million pesos or more, never converted.
  const significant = whole.replace(/^0+/, "");
  if (significant.length > MAX_WHOLE_DIGITS) return { kind: "out_of_range", marked };

  // 6. Convert.
  const centavos = Number(significant === "" ? "0" : significant) * 100 + Number(fraction.padEnd(2, "0"));
  if (centavos === 0) return { kind: "out_of_range", marked };
  return { kind: "amount", centavos, marked };
}
