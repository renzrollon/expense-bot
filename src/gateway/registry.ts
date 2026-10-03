import type { Api, Context } from "grammy";

export interface FeatureModule {
  name: string;
  commands?: CommandRegistration[];
  callbacks?: CallbackRegistration[];
  messages?: UpdateHandler[];
  editedMessages?: UpdateHandler[];
  jobs?: JobRegistration[];
  status?: (ctx: BotContext) => Promise<string[]>;
}

export interface CommandRegistration {
  name: string;
  description: string;
  handle: (ctx: BotContext, args: string) => Promise<void>;
}

export interface CallbackRegistration {
  prefix: string;
  handle: (ctx: BotContext, payload: string) => Promise<void>;
}

export type UpdateHandler = (ctx: BotContext) => Promise<void>;

export interface JobRegistration {
  name: string;
  schedule: JobSchedule;
  run: (job: JobContext) => Promise<void>;
  /**
   * How many hours after its slot a run may still start: a whole number, shorter than
   * the time between two slots. Later, the scheduled date is skipped. The default is 3.
   */
  catchUpHours?: number;
  /**
   * When true, the scheduler tells the group once when the catch-up window of a
   * scheduled date has ended and the run is still not done, or when the date was
   * skipped after the job had run before.
   */
  alertOnFailure?: boolean;
}

export type JobSchedule =
  | { every: "day"; hour: number }
  | { every: "week"; weekday: number; hour: number }
  | { every: "month"; day: number; hour: number };

export interface JobContext {
  env: Env;
  db: D1Database;
  now: Date;
  timezone: string;
  chatId: number;
  api: Api;
  /**
   * The local date (YYYY-MM-DD, household timezone) of the slot this run belongs to.
   * Decide the day, week or month a job covers from this, never from `now`:
   * a late run, inside the job's catch-up window, still belongs to its scheduled date.
   */
  scheduledDate: string;
}

export type BotContext = Context & {
  gateway: {
    env: Env;
    db: D1Database;
    now: Date;
    timezone: string;
    chatId: number;
    member: { userId: number; displayName: string };
    registry: Registry;
  };
};

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

export interface Registry {
  commands: (CommandRegistration & { module: string })[];
  callbacks: (CallbackRegistration & { module: string })[];
  messages: { module: string; handle: UpdateHandler }[];
  editedMessages: { module: string; handle: UpdateHandler }[];
  jobs: (JobRegistration & { module: string })[];
  status: { module: string; report: (ctx: BotContext) => Promise<string[]> }[];
}

const COMMAND_NAME = /^[a-z0-9_]{1,32}$/;
const CALLBACK_PREFIX = /^[a-z0-9]{1,8}$/;

/**
 * Validates the feature modules and collects their registrations, each tagged
 * with its module's name and kept in registration order (Decision 9).
 * Throws RegistrationError naming the offending value and the modules involved.
 */
export function buildRegistry(modules: FeatureModule[]): Registry {
  const registry: Registry = {
    commands: [],
    callbacks: [],
    messages: [],
    editedMessages: [],
    jobs: [],
    status: [],
  };
  const moduleNames = new Set<string>();
  const commandOwners = new Map<string, string>();
  const prefixOwners = new Map<string, string>();
  const jobOwners = new Map<string, string>();

  for (const mod of modules) {
    const module = mod.name;
    if (moduleNames.has(module)) {
      throw new RegistrationError(`Module name "${module}" is registered more than once`);
    }
    moduleNames.add(module);

    for (const cmd of mod.commands ?? []) {
      if (!COMMAND_NAME.test(cmd.name)) {
        throw new RegistrationError(
          `Command name "${cmd.name}" in module "${module}" must be 1 to 32 of a-z, 0-9 and _`,
        );
      }
      if (typeof cmd.description !== "string" || cmd.description.trim() === "") {
        throw new RegistrationError(`Command "${cmd.name}" in module "${module}" has no description`);
      }
      claim(commandOwners, cmd.name, module, "Command");
      registry.commands.push({ ...cmd, module });
    }

    for (const cb of mod.callbacks ?? []) {
      if (!CALLBACK_PREFIX.test(cb.prefix)) {
        throw new RegistrationError(
          `Button prefix "${cb.prefix}" in module "${module}" must be 1 to 8 of a-z and 0-9`,
        );
      }
      claim(prefixOwners, cb.prefix, module, "Button prefix");
      registry.callbacks.push({ ...cb, module });
    }

    for (const handle of mod.messages ?? []) registry.messages.push({ module, handle });
    for (const handle of mod.editedMessages ?? []) registry.editedMessages.push({ module, handle });

    for (const job of mod.jobs ?? []) {
      claim(jobOwners, job.name, module, "Job");
      registry.jobs.push({ ...job, module });
    }

    if (mod.status !== undefined) registry.status.push({ module, report: mod.status });
  }

  return registry;
}

/** Records that `module` owns `value`, and refuses a value another registration already owns. */
function claim(owners: Map<string, string>, value: string, module: string, what: string): void {
  const owner = owners.get(value);
  if (owner !== undefined) {
    const involved = owner === module ? `module "${module}"` : `modules "${owner}" and "${module}"`;
    throw new RegistrationError(`${what} "${value}" is registered more than once, by ${involved}`);
  }
  owners.set(value, module);
}
