import { isCategoryId } from "../categories";

export type PressKind = "c" | "s" | "u" | "r" | "b";

export type Press =
  | { kind: "c" | "u" | "r" | "b"; entryId: number }
  | { kind: "s"; entryId: number; categoryId: string };

/** A positive whole number without a sign, a leading zero or white space (D6). */
const ENTRY_ID = /^[1-9][0-9]{0,15}$/;

function parseEntryId(text: string): number | null {
  if (!ENTRY_ID.test(text)) return null;
  const id = Number(text);
  // A 16-digit id past 2^53 would round to another entry's id.
  return Number.isSafeInteger(id) ? id : null;
}

/** The only parser of press data. `payload` is the data after the prefix and its colon. */
export function parsePress(kind: PressKind, payload: string): Press | null {
  if (kind === "s") {
    const colon = payload.indexOf(":");
    if (colon === -1) return null;
    const entryId = parseEntryId(payload.slice(0, colon));
    const categoryId = payload.slice(colon + 1);
    if (entryId === null || !isCategoryId(categoryId)) return null;
    return { kind, entryId, categoryId };
  }
  const entryId = parseEntryId(payload);
  return entryId === null ? null : { kind, entryId };
}
