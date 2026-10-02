import { capture } from "./capture";
import { core } from "./core";
import type { FeatureModule } from "./gateway/registry";
import { scheduler } from "./scheduler";

export const modules: FeatureModule[] = [
  core,
  scheduler,
  capture,
];
