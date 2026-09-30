export type Flag = "ambiguous_amount";

export type Confidence = "high" | "low";

export type RejectionReason =
  | "multiple_dates"
  | "invalid_date"
  | "future_date"
  | "amount_out_of_range"
  | "too_many_items";

export interface ParsedItem {
  /** Whole number, 1 to 999999999. */
  amountCentavos: number;
  /** May be empty. */
  description: string;
  /** YYYY-MM-DD in the household timezone. */
  date: string;
  flags: Flag[];
  confidence: Confidence;
}

export type ParseResult =
  | { kind: "items"; items: ParsedItem[] }
  | { kind: "not_expense" }
  | { kind: "rejected"; reason: RejectionReason };
