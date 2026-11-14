import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = {
  candidate: new URL("../lib/reconcile-release-candidate.sh", import.meta.url),
  "pull-request": new URL("../lib/reconcile-release-pull-request.sh", import.meta.url),
  tag: new URL("../lib/reconcile-release-tag.sh", import.meta.url),
};
const script = scripts[process.argv[2]];
if (!script) throw new Error("release_workflow_operation_invalid");
const result = spawnSync("bash", [fileURLToPath(script)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
