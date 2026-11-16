import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describeCliReleaseMetadataChange } from "../lib/cli-release-metadata-report.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const manifestPath = "apps/cli/release-artifact-manifest.json";
const sbomPath = "apps/cli/release-sbom.cdx.json";

const committed = (path) =>
  JSON.parse(
    execFileSync("git", ["show", `HEAD:${path}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const generated = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));

try {
  process.stdout.write(
    describeCliReleaseMetadataChange({
      releaseMetadata: process.argv[2],
      committedManifest: committed(manifestPath),
      generatedManifest: await generated(manifestPath),
      committedSbom: committed(sbomPath),
      generatedSbom: await generated(sbomPath),
    }),
  );
} catch (error) {
  console.error(
    "release_metadata_report_failed: The committed and generated CLI release metadata could not be compared.",
  );
  if (error instanceof Error) console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
}
