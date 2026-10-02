import { env } from "cloudflare:workers";
import { capture } from "./capture";
import { core } from "./core";
import { corrections } from "./corrections";
import { digests } from "./digests";
import { exporter } from "./export";
import type { FeatureModule } from "./gateway/registry";
import { createNudge } from "./nudge";
import { readNudgeSettings } from "./nudge/settings";
import { reports } from "./reports";
import { scheduler } from "./scheduler";

export const modules: FeatureModule[] = [
  core,
  scheduler,
  reports,
  corrections,
  digests,
  createNudge(readNudgeSettings({ ...env })),
  exporter,
  capture, // stays last: it is the only message handler
];
