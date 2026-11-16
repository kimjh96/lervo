import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { cliReleaseMetadataScope } from "../lib/cli-release-metadata-scope.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const checks = [
  "check-cli-release-artifact.mjs",
  "check-cli-release-sbom.mjs",
  "check-cli-release-attestation.mjs",
];

const { scope, version } = await cliReleaseMetadataScope(repositoryRoot);
if (scope === "released") {
  console.log(
    `CLI release metadata checks skipped: v${version} is already released, so the committed ` +
      "manifest and SBOM may describe an older build until the next release preparation. CI " +
      "generates and reports them for this change (ADR-0572).",
  );
} else {
  for (const check of checks) {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, check)], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
