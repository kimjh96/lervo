import { isAbsolute } from "node:path";

import { parse } from "yaml";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";

const maximumPackageBytes = 1024 * 1024;
const maximumWorkflowBytes = 256 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_source_invalid",
    "The CLI first-publication workflow activation source is invalid.",
  );
}

function snapshot(path, contents, maximumSize) {
  return {
    path,
    contents,
    maximumSize,
    byteCount: contents.length,
    sha256: sha256(contents),
  };
}

export async function readFirstPublicationWorkflowActivationSources({
  packageManifestPath,
  workflowPath,
}) {
  if (!isAbsolute(packageManifestPath ?? "") || !isAbsolute(workflowPath ?? "")) fail();
  let packageContents;
  let workflowContents;
  try {
    [packageContents, workflowContents] = await Promise.all([
      readRegularReleaseFile(packageManifestPath, maximumPackageBytes),
      readRegularReleaseFile(workflowPath, maximumWorkflowBytes),
    ]);
  } catch {
    fail();
  }
  let packageManifest;
  let workflow;
  try {
    packageManifest = JSON.parse(packageContents.toString("utf8"));
    workflow = parse(workflowContents.toString("utf8"));
  } catch {
    fail();
  }
  if (
    packageManifest === null ||
    typeof packageManifest !== "object" ||
    Array.isArray(packageManifest) ||
    workflow === null ||
    typeof workflow !== "object" ||
    Array.isArray(workflow)
  )
    fail();
  const packageFile = snapshot(packageManifestPath, packageContents, maximumPackageBytes);
  const workflowFile = snapshot(workflowPath, workflowContents, maximumWorkflowBytes);
  return {
    packageManifest,
    workflow,
    packageSnapshot: {
      contents: packageFile.contents,
      byteCount: packageFile.byteCount,
      sha256: packageFile.sha256,
    },
    workflowSnapshot: {
      contents: workflowFile.contents,
      byteCount: workflowFile.byteCount,
      sha256: workflowFile.sha256,
    },
    assertUnchanged: () => assertReleaseFilesUnchanged([packageFile, workflowFile]),
  };
}
