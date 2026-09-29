import { describe, expect, it } from "vitest";
import {
  RegistrationError,
  buildRegistry,
  type FeatureModule,
  type JobSchedule,
} from "../../src/gateway/registry";
import { probeModule } from "../helpers/probe";

/** Returns the RegistrationError that buildRegistry throws, and rethrows any other error. */
function registrationError(modules: FeatureModule[]): RegistrationError {
  try {
    buildRegistry(modules);
  } catch (error) {
    if (error instanceof RegistrationError) return error;
    throw error;
  }
  throw new Error("buildRegistry did not throw");
}

function expectRefused(modules: FeatureModule[], ...named: string[]): void {
  const error = registrationError(modules);
  expect(error).toBeInstanceOf(RegistrationError);
  expect(error.name).toBe("RegistrationError");
  for (const value of named) expect(error.message).toContain(value);
}

function command(name: string, description = `does ${name}`) {
  return { name, description, handle: async () => {} };
}

function callback(prefix: string) {
  return { prefix, handle: async () => {} };
}

describe("Registration validation", () => {
  it("Duplicate command name", () => {
    expectRefused(
      [
        { name: "ledger", commands: [command("tally")] },
        { name: "budget", commands: [command("tally")] },
      ],
      "tally",
      "ledger",
      "budget",
    );
  });

  it.each([
    ["an uppercase letter", "Tally"],
    ["a slash", "/tally"],
    ["more than 32 characters", "t".repeat(33)],
    ["a hyphen", "tally-up"],
  ])("Invalid command name: %s", (_label, name) => {
    expectRefused([{ name: "ledger", commands: [command(name)] }], name, "ledger");
  });

  it("Invalid command name: empty", () => {
    expectRefused([{ name: "ledger", commands: [command("")] }], "ledger");
  });

  it("Command without a description", () => {
    expectRefused([{ name: "ledger", commands: [command("tally", "")] }], "tally", "ledger");
  });

  it("Duplicate button prefix", () => {
    expectRefused(
      [
        { name: "ledger", callbacks: [callback("pick")] },
        { name: "budget", callbacks: [callback("pick")] },
      ],
      "pick",
      "ledger",
      "budget",
    );
  });

  it.each([
    ["a colon", "pi:ck"],
    ["an uppercase letter", "Pick"],
    ["more than 8 characters", "abcdefghi"],
    ["an underscore", "pi_ck"],
  ])("Invalid button prefix: %s", (_label, prefix) => {
    expectRefused([{ name: "ledger", callbacks: [callback(prefix)] }], prefix, "ledger");
  });

  it("Invalid button prefix: empty", () => {
    expectRefused([{ name: "ledger", callbacks: [callback("")] }], "ledger");
  });

  it("Duplicate job name", () => {
    const job = { name: "nightly", schedule: { every: "day", hour: 21 } as JobSchedule, run: async () => {} };
    expectRefused(
      [
        { name: "ledger", jobs: [job] },
        { name: "budget", jobs: [{ ...job }] },
      ],
      "nightly",
      "ledger",
      "budget",
    );
  });

  it("Duplicate module name", () => {
    expectRefused([{ name: "ledger" }, { name: "ledger" }], "ledger");
  });

  it("Duplicate command name within one module", () => {
    expectRefused([{ name: "ledger", commands: [command("tally"), command("tally")] }], "tally", "ledger");
  });

  it("accepts the longest command name and button prefix", () => {
    const registry = buildRegistry([
      { name: "ledger", commands: [command("a_1".padEnd(32, "z"))], callbacks: [callback("abcdefg8")] },
    ]);
    expect(registry.commands.map((c) => c.name)).toEqual(["a_1".padEnd(32, "z")]);
    expect(registry.callbacks.map((c) => c.prefix)).toEqual(["abcdefg8"]);
  });

  it("Valid registrations", () => {
    const first = probeModule({
      name: "ledger",
      commands: ["tally", "undo"],
      callbacks: ["pick"],
      messages: ["capture"],
      editedMessages: ["fix"],
      jobs: [{ name: "nightly" }],
      status: ["Ledger: ok"],
    });
    const second = probeModule({
      name: "budget",
      commands: ["today"],
      callbacks: ["cat", "b2"],
      messages: ["watch", "count"],
      editedMessages: ["recheck"],
      jobs: [{ name: "weekly", schedule: { every: "week", weekday: 1, hour: 8 } }],
      status: ["Budget: ok"],
    });
    const registry = buildRegistry([first.module, second.module]);

    expect(registry.commands.map((c) => [c.module, c.name, c.description])).toEqual([
      ["ledger", "tally", "Probe command tally"],
      ["ledger", "undo", "Probe command undo"],
      ["budget", "today", "Probe command today"],
    ]);
    expect(registry.commands[0]?.handle).toBe(first.module.commands?.[0]?.handle);
    expect(registry.callbacks.map((c) => [c.module, c.prefix])).toEqual([
      ["ledger", "pick"],
      ["budget", "cat"],
      ["budget", "b2"],
    ]);
    expect(registry.callbacks[2]?.handle).toBe(second.module.callbacks?.[1]?.handle);
    expect(registry.messages.map((m) => m.module)).toEqual(["ledger", "budget", "budget"]);
    expect(registry.messages.map((m) => m.handle)).toEqual([
      first.module.messages?.[0],
      second.module.messages?.[0],
      second.module.messages?.[1],
    ]);
    expect(registry.editedMessages.map((m) => m.module)).toEqual(["ledger", "budget"]);
    expect(registry.editedMessages[1]?.handle).toBe(second.module.editedMessages?.[0]);
    expect(registry.jobs.map((j) => [j.module, j.name])).toEqual([
      ["ledger", "nightly"],
      ["budget", "weekly"],
    ]);
    expect(registry.status.map((s) => s.module)).toEqual(["ledger", "budget"]);
    expect(registry.status[0]?.report).toBe(first.module.status);
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual([]);
  });

  it("builds an empty registry for modules that register nothing", () => {
    expect(buildRegistry([{ name: "ledger" }, { name: "budget" }])).toEqual({
      commands: [],
      callbacks: [],
      messages: [],
      editedMessages: [],
      jobs: [],
      status: [],
    });
  });
});

describe("Job registration", () => {
  it("Job is recorded", () => {
    const schedules: JobSchedule[] = [
      { every: "day", hour: 9 },
      { every: "week", weekday: 7, hour: 20 },
      { every: "month", day: 1, hour: 6 },
    ];
    const probe = probeModule({
      name: "scheduler",
      jobs: [
        { name: "daily", schedule: schedules[0] },
        { name: "weekly", schedule: schedules[1] },
        { name: "monthly", schedule: schedules[2] },
      ],
    });
    const registry = buildRegistry([probe.module]);

    expect(registry.jobs.map((j) => ({ name: j.name, schedule: j.schedule, module: j.module }))).toEqual([
      { name: "daily", schedule: schedules[0], module: "scheduler" },
      { name: "weekly", schedule: schedules[1], module: "scheduler" },
      { name: "monthly", schedule: schedules[2], module: "scheduler" },
    ]);
    expect(registry.jobs[1]?.run).toBe(probe.module.jobs?.[1]?.run);
    expect(probe.callsTo("job:daily")).toEqual([]);
    expect(probe.calls).toEqual([]);
  });
});
