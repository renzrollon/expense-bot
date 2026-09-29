export interface TelegramCall {
  method: string;
  payload: unknown;
}

export interface TelegramStub {
  calls: TelegramCall[];
  /** Sets the `result` returned for a method. The default is `true`. */
  setResult(method: string, result: unknown): void;
  /** Calls recorded for one method. */
  callsTo(method: string): TelegramCall[];
  restore(): void;
}

const TELEGRAM_URL = /^https:\/\/api\.telegram\.org\/(?:file\/)?bot[^/]*\/([^/?#]+)/;

async function readPayload(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  let text: string | undefined;
  if (typeof init?.body === "string") text = init.body;
  else if (input instanceof Request) text = await input.clone().text();
  if (text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Replaces globalThis.fetch. Calls to the Telegram Bot API are recorded and
 * answered with `{ ok: true, result }`. Any other request goes to the real fetch.
 */
export function installTelegramStub(): TelegramStub {
  const original = globalThis.fetch;
  const calls: TelegramCall[] = [];
  const results = new Map<string, unknown>();

  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const match = TELEGRAM_URL.exec(url);
    if (!match?.[1]) return original(input, init);
    const method = match[1];
    calls.push({ method, payload: await readPayload(input, init) });
    const result = results.has(method) ? results.get(method) : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });
  };

  globalThis.fetch = stub as typeof fetch;

  return {
    calls,
    setResult: (method, result) => {
      results.set(method, result);
    },
    callsTo: (method) => calls.filter((call) => call.method === method),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
