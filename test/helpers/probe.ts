import type {
  BotContext,
  FeatureModule,
  JobContext,
  JobSchedule,
} from "../../src/gateway/registry";

export interface ProbeCall {
  /** For example `command:ping`, `callback:add`, `message:first`, `job:daily`, `status`. */
  handler: string;
  args: unknown[];
}

export interface ProbeOptions {
  name?: string;
  commands?: string[];
  callbacks?: string[];
  messages?: string[];
  editedMessages?: string[];
  jobs?: { name: string; schedule?: JobSchedule }[];
  status?: string[];
}

export interface Probe {
  module: FeatureModule;
  calls: ProbeCall[];
  callsTo(handler: string): ProbeCall[];
  /** Handlers throw this error after recording their call. Limit it to one handler by name. */
  failWith(error: unknown, handler?: string): void;
  clearFailure(): void;
}

/** A module whose handlers record each call and can be told to fail. */
export function probeModule(options: ProbeOptions = {}): Probe {
  const calls: ProbeCall[] = [];
  let failure: { error: unknown; handler: string | undefined } | null = null;

  const record = (handler: string, args: unknown[]): void => {
    calls.push({ handler, args });
    if (failure && (failure.handler === undefined || failure.handler === handler)) {
      throw failure.error;
    }
  };

  const module: FeatureModule = {
    name: options.name ?? "probe",
    commands: (options.commands ?? []).map((name) => ({
      name,
      description: `Probe command ${name}`,
      handle: async (ctx: BotContext, args: string) => record(`command:${name}`, [ctx, args]),
    })),
    callbacks: (options.callbacks ?? []).map((prefix) => ({
      prefix,
      handle: async (ctx: BotContext, payload: string) =>
        record(`callback:${prefix}`, [ctx, payload]),
    })),
    messages: (options.messages ?? []).map(
      (label) => async (ctx: BotContext) => record(`message:${label}`, [ctx]),
    ),
    editedMessages: (options.editedMessages ?? []).map(
      (label) => async (ctx: BotContext) => record(`edited:${label}`, [ctx]),
    ),
    jobs: (options.jobs ?? []).map((job) => ({
      name: job.name,
      schedule: job.schedule ?? { every: "day", hour: 9 },
      run: async (context: JobContext) => record(`job:${job.name}`, [context]),
    })),
    ...(options.status
      ? {
          status: async (ctx: BotContext) => {
            record("status", [ctx]);
            return options.status ?? [];
          },
        }
      : {}),
  };

  return {
    module,
    calls,
    callsTo: (handler) => calls.filter((call) => call.handler === handler),
    failWith: (error, handler) => {
      failure = { error, handler };
    },
    clearFailure: () => {
      failure = null;
    },
  };
}
