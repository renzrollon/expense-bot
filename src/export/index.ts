import { NIGHTLY_BACKUP } from "../config/schedule";
import type { FeatureModule } from "../gateway/registry";
import { NIGHTLY_BACKUP_JOB, runNightlyBackup } from "./backup";
import { EXPORT_DESCRIPTION, handleExport } from "./command";

export { readBackupChatId } from "./backup";

/** The `export` module: `/export` and the nightly backup (design Decisions 15 and 16). */
export const exporter: FeatureModule = {
  name: "export",
  commands: [{ name: "export", description: EXPORT_DESCRIPTION, handle: handleExport }],
  jobs: [{ name: NIGHTLY_BACKUP_JOB, schedule: NIGHTLY_BACKUP, run: runNightlyBackup, alertOnFailure: true }],
};
