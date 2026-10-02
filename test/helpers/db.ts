import { beforeEach } from "vitest";

export const TABLES = [
  "updates",
  "members",
  "settings",
  "expenses",
  "keyword_map",
  "job_runs",
  "day_marks",
  "job_sends",
] as const;

/** Empties every table in TABLES. */
export async function resetTables(db: D1Database): Promise<void> {
  await db.batch(TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));
}

/** Registers a beforeEach hook that empties every table in TABLES. */
export function useCleanTables(db: D1Database): void {
  beforeEach(async () => {
    await resetTables(db);
  });
}

export interface FailingDb {
  db: D1Database;
  /** Every later statement fails when it is executed. */
  failAll(): void;
  /** A statement fails when the predicate accepts its SQL text. */
  failWhen(predicate: (sql: string) => boolean): void;
  /**
   * Inside `db.batch`, each statement the predicate accepts, by its normalised SQL
   * text and its position in the batch, is replaced by `SELECT json('{')` and the
   * batch is sent to D1. SQLite prepares that statement and refuses it when it
   * runs, so the statements before it really run and D1 must roll them back.
   * Statements outside a batch are unaffected.
   */
  failInsideBatch(predicate: (sql: string, position: number) => boolean): void;
  /** Stops all failing. */
  heal(): void;
}

/** SQL text with every run of white space collapsed to one space, trimmed. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Prepares cleanly and fails when it runs, with "malformed JSON". */
const MALFORMED_AT_RUN = "SELECT json('{')";

interface Wrapped {
  real: D1PreparedStatement;
  sql: string;
}

/**
 * Wraps a D1 binding. A failing statement rejects when it is executed, through
 * first, run, all, raw, batch or exec, and not when it is prepared.
 */
export function failingDb(real: D1Database): FailingDb {
  let all = false;
  let predicate: ((sql: string) => boolean) | null = null;
  let insideBatch: ((sql: string, position: number) => boolean) | null = null;
  const wrapped = new WeakMap<object, Wrapped>();

  const shouldFail = (sql: string): boolean =>
    all || (predicate !== null && predicate(normalizeSql(sql)));

  const check = (sql: string): void => {
    if (shouldFail(sql)) throw new Error(`D1 failure injected for: ${normalizeSql(sql)}`);
  };

  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy: object = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      first: async (...args: unknown[]) => {
        check(sql);
        return (statement.first as (...a: unknown[]) => Promise<unknown>)(...args);
      },
      run: async () => {
        check(sql);
        return statement.run();
      },
      all: async () => {
        check(sql);
        return statement.all();
      },
      raw: async (...args: unknown[]) => {
        check(sql);
        return (statement.raw as (...a: unknown[]) => Promise<unknown>)(...args);
      },
    };
    wrapped.set(proxy, { real: statement, sql });
    return proxy as D1PreparedStatement;
  };

  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => wrap(target.prepare(sql), sql);
      }
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const entries = statements.map((statement) => wrapped.get(statement));
          for (const entry of entries) if (entry) check(entry.sql);
          return target.batch(
            entries.map((entry, i) =>
              entry && insideBatch?.(normalizeSql(entry.sql), i)
                ? target.prepare(MALFORMED_AT_RUN)
                : (entry?.real ?? statements[i]!),
            ),
          );
        };
      }
      if (prop === "exec") {
        return async (sql: string) => {
          check(sql);
          return target.exec(sql);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    db,
    failAll: () => {
      all = true;
    },
    failWhen: (next) => {
      predicate = next;
    },
    failInsideBatch: (next) => {
      insideBatch = next;
    },
    heal: () => {
      all = false;
      predicate = null;
      insideBatch = null;
    },
  };
}
