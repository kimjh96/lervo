import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  readFirstPublicationWorkflowActivationSources,
} from "./first-publication-workflow-activation-sources.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

const maximumJsonBytes = 1024 * 1024;
const maximumDecisionBytes = 64 * 1024;

export const firstPublicationWorkflowActivationPaths = Object.freeze({
  packageManifestPath: resolve(repositoryRoot, "package.json"),
  cliPackageManifestPath: resolve(repositoryRoot, "apps/cli/package.json"),
  workflowPath: resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml"),
});

function fail(code = "first_publication_workflow_activation_permit_source_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication workflow activation authorization source is invalid.",
  );
}

function parseCanonicalJson(contents, maximumSize) {
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    !contents.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
  ) fail();
  return {
    value,
    snapshot: {
      contents,
      byteCount: contents.length,
      sha256: sha256(contents),
      maximumSize,
    },
  };
}

async function readExtra(path, maximumSize) {
  if (!isAbsolute(path ?? "")) fail();
  let contents;
  try {
    contents = await readRegularReleaseFile(path, maximumSize);
  } catch {
    fail();
  }
  const parsed = parseCanonicalJson(contents, maximumSize);
  return {
    value: parsed.value,
    snapshot: { path, ...parsed.snapshot },
  };
}

async function readSources(paths, decisionPath, permitPath) {
  if (
    !isAbsolute(paths?.packageManifestPath ?? "") ||
    !isAbsolute(paths?.cliPackageManifestPath ?? "") ||
    !isAbsolute(paths?.workflowPath ?? "")
  ) fail();
  const [base, cliPackage, decision, permit] = await Promise.all([
    readFirstPublicationWorkflowActivationSources(paths),
    readExtra(paths.cliPackageManifestPath, maximumJsonBytes),
    readExtra(decisionPath, maximumDecisionBytes),
    permitPath === undefined ? undefined : readExtra(permitPath, maximumDecisionBytes),
  ]);
  const extras = [cliPackage.snapshot, decision.snapshot,
    ...(permit === undefined ? [] : [permit.snapshot])];
  return {
    packageManifest: base.packageManifest,
    cliPackageManifest: cliPackage.value,
    workflow: base.workflow,
    decision: decision.value,
    ...(permit === undefined ? {} : { permit: permit.value }),
    packageSnapshot: base.packageSnapshot,
    workflowSnapshot: base.workflowSnapshot,
    sourceSnapshots: {
      cliPackage: cliPackage.snapshot,
      decision: decision.snapshot,
      ...(permit === undefined ? {} : { permit: permit.snapshot }),
    },
    assertUnchanged: async () => {
      await Promise.all([
        base.assertUnchanged(),
        assertReleaseFilesUnchanged(extras),
      ]);
    },
  };
}

export function readFirstPublicationWorkflowActivationPermitSources(
  paths,
  decisionPath,
) {
  return readSources(paths, decisionPath);
}

export function readFirstPublicationWorkflowActivationApplySources(
  paths,
  decisionPath,
  permitPath,
) {
  return readSources(paths, decisionPath, permitPath);
}
