export type Compare = (a: Uint8Array, b: Uint8Array) => boolean;

/**
 * The default comparison. It is a wrapper rather than a bare method reference,
 * because the Workers runtime rejects a native method called without its receiver.
 */
const timingSafeEqual: Compare = (a, b) => (crypto.subtle as SubtleCrypto & WorkersSubtle).timingSafeEqual(a, b);

/** The Workers extension of SubtleCrypto; the Node globals shadow the Workers declaration. */
interface WorkersSubtle {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
}

const encoder = new TextEncoder();

/**
 * Checks the webhook secret header in constant time (Decision 4, D4, D43).
 * An empty or missing configured secret rejects every request. When the lengths
 * differ, the received value is compared against itself and the result negated,
 * so exactly one full comparison runs either way.
 */
export function secretMatches(
  received: string | null,
  expected: string | undefined,
  compare: Compare = timingSafeEqual,
): boolean {
  if (expected === undefined || expected === "") return false;
  if (received === null || received === "") return false;
  const a = encoder.encode(received);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) {
    return !compare(a, a);
  }
  return compare(a, b);
}
