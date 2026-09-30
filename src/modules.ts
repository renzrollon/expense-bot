import { capture } from "./capture";
import { core } from "./core";
import type { FeatureModule } from "./gateway/registry";

export const modules: FeatureModule[] = [
  core,
  capture,
];
