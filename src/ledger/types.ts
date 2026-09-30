/** Where an entry's category came from (design Decision 2, D30). */
export type CategorySource = "keyword" | "learned" | "llm" | "manual" | "default";

/** Which parser produced an entry. */
export type ParserKind = "rules" | "llm";

/** One item of a message to store. Field names follow the parser's items (Decision 1). */
export interface NewEntryItem {
  amountCentavos: number;
  description: string;
  spentOn: string;
  categoryId: string;
  categorySource: CategorySource;
  checkAmount: boolean;
}

/** Every item of one message, written all or nothing (Decision 4). */
export interface NewMessageEntries {
  chatId: number;
  sourceMessageId: number;
  payerUserId: number;
  byUserId: number;
  rawText: string;
  parser: ParserKind;
  now: Date;
  items: NewEntryItem[];
}

/** One stored entry, mapped from its snake_case row. */
export interface Entry {
  id: number;
  chatId: number;
  sourceMessageId: number;
  itemIndex: number;
  confirmationMessageId: number | null;
  payerUserId: number;
  amountCentavos: number;
  currency: string;
  description: string;
  categoryId: string;
  categorySource: CategorySource;
  spentOn: string;
  rawText: string;
  parser: ParserKind;
  checkAmount: boolean;
  createdAt: string;
  createdBy: number;
  updatedAt: string;
  updatedBy: number;
  deletedAt: string | null;
  deletedBy: number | null;
}

/** The result of `addMessageEntries`: `created` is false when the message was already stored. */
export interface AddResult {
  created: boolean;
  entries: Entry[];
}

/** The result of a guarded change of state (Decision 3, D14). */
export type ChangeResult =
  | { outcome: "changed"; entry: Entry }
  | { outcome: "unchanged"; entry: Entry }
  | { outcome: "not_found" };

/** A change to one entry by a member. */
export interface EntryChange {
  id: number;
  byUserId: number;
  now: Date;
}

/** A change of one entry's category. */
export interface CategoryChange extends EntryChange {
  categoryId: string;
  categorySource: CategorySource;
}

/** An inclusive range of local dates, as `YYYY-MM-DD`. */
export interface Period {
  from: string;
  to: string;
}

/** The sum and count of active entries in one category. */
export interface CategoryTotal {
  categoryId: string;
  totalCentavos: number;
  count: number;
}
