import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareNativeRuntimeReuse,
  createNativeRuntimeReuse,
  restoreNativeRuntimeReuse,
  verifyNativeRuntimeReuse,
} from "./lib/native-runtime-reuse-artifact.mjs";
import {
  nativeRuntimeReuseArtifactName,
  nativeRuntimeReuseInputs,
  nativeRuntimeReuseKey,
} from "./lib/native-runtime-reuse-key.mjs";
import { findNativeRuntimeReuseRun } from "./lib/native-runtime-reuse-source.mjs";

// Reuses verified darwin native files for identical build inputs instead of compiling them on
// macOS again (ADR-0590). Any failure here leaves the caller to build.
const usage =
  "Usage: native-runtime-reuse.mjs <find | create <dir> | verify <dir> | restore <dir> | compare <fresh-dir> <reused-dir>>";
const arities = { find: 0, create: 1, verify: 1, restore: 1, compare: 2 };
const [operation, ...paths] = process.argv.slice(2);
if (arities[operation] !== paths.length) throw new Error(usage);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const [first, second] = paths.map((path) => resolve(path));

async function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
  );
}

async function summarize(line) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

let result;
if (operation === "find") {
  const key = nativeRuntimeReuseKey(await nativeRuntimeReuseInputs({ repositoryRoot }));
  const found = findNativeRuntimeReuseRun({ repository: process.env.GITHUB_REPOSITORY, key });
  result = {
    key,
    lookup: found.status,
    artifact: found.artifactName ?? "",
    artifactId: found.artifactId ? String(found.artifactId) : "",
    run: found.runId ? String(found.runId) : "",
  };
  await writeOutputs(result);
  // A failed lookup only costs a macOS build, but it must not look like an ordinary miss.
  if (found.status === "unavailable")
    process.stdout.write(
      `::warning title=Native reuse lookup failed::The GitHub API failed; macOS builds the darwin files.\n`,
    );
  await summarize(
    {
      found: `Darwin native files: main run ${found.runId} built inputs ${key}.`,
      none: `Darwin native files: no main build for inputs ${key}; macOS builds them.`,
      unavailable: `Darwin native files: the lookup failed for inputs ${key}; macOS builds them.`,
    }[found.status],
  );
} else if (operation === "create") {
  result = await createNativeRuntimeReuse({ repositoryRoot, artifactDirectory: first });
  await writeOutputs({ key: result.key, artifact: nativeRuntimeReuseArtifactName(result.key) });
} else if (operation === "verify") {
  result = (await verifyNativeRuntimeReuse({ repositoryRoot, artifactDirectory: first })).receipt;
} else if (operation === "restore") {
  result = await restoreNativeRuntimeReuse({ repositoryRoot, artifactDirectory: first });
  await summarize(
    `Darwin native files: restored ${result.artifactDigest} from run ${result.producer.runId}.`,
  );
} else {
  result = await compareNativeRuntimeReuse({
    repositoryRoot,
    freshDirectory: first,
    reusedDirectory: second,
  });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
