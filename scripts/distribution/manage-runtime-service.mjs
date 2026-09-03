import { resolve } from "node:path";

import {
  manageRuntimeService,
  RuntimeServiceManagementError,
} from "./lib/runtime-service-management.mjs";

export { manageRuntimeService, RuntimeServiceManagementError };

function statusText(result) {
  if (!result.managerAvailable) return "manager_unavailable";
  if (!result.installed && !result.active && result.enabled !== true) return "not_installed";
  if (result.installed && result.active && result.enabled !== false) return "active";
  return "inactive_or_inconsistent";
}

async function run() {
  try {
    const result = await manageRuntimeService(process.argv.slice(2));
    process.stdout.write(
      `Lervo ${result.runtime} ${result.manager} user service status: ${statusText(result)}.\n`,
    );
  } catch (error) {
    const code =
      error instanceof RuntimeServiceManagementError ? error.code : "service_management_failed";
    process.stderr.write(`Lervo user service operation failed (${code}).\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename.endsWith("/manage-runtime-service.mjs") &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  await run();
