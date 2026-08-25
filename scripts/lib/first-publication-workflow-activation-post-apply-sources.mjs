import { isAbsolute, resolve } from "node:path";

import { parseDocument } from "yaml";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

const maximumJsonBytes = 1024 * 1024;
const maximumReceiptBytes = 64 * 1024;
const maximumWorkflowBytes = 256 * 1024;

export const firstPublicationWorkflowActivationPostApplyPaths = Object.freeze({
  packageManifestPath: resolve(repositoryRoot, "package.json"),
  cliPackageManifestPath: resolve(repositoryRoot, "apps/cli/package.json"),
  workflowPath: resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_post_apply_source_invalid",
    "The CLI first-publication workflow activation post-apply verification source is invalid.",
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

function parseCanonicalJson(contents) {
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !contents.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
  )
    fail();
  return value;
}

function parseWorkflow(contents) {
  let text;
  let document;
  let workflow;
  try {
    text = contents.toString("utf8");
    if (!contents.equals(Buffer.from(text)) || !text.endsWith("\n") || text.includes("\r")) {
      fail();
    }
    document = parseDocument(text, { uniqueKeys: true });
    workflow = document.toJS();
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  if (
    document.errors.length > 0 ||
    document.warnings.length > 0 ||
    workflow === null ||
    typeof workflow !== "object" ||
    Array.isArray(workflow)
  )
    fail();
  return workflow;
}

export async function readFirstPublicationWorkflowActivationPostApplySources(paths, receiptPath) {
  if (
    !isAbsolute(paths?.packageManifestPath ?? "") ||
    !isAbsolute(paths?.cliPackageManifestPath ?? "") ||
    !isAbsolute(paths?.workflowPath ?? "") ||
    !isAbsolute(receiptPath ?? "")
  )
    fail();
  let rootPackageContents;
  let cliPackageContents;
  let workflowContents;
  let receiptContents;
  try {
    [rootPackageContents, cliPackageContents, workflowContents, receiptContents] =
      await Promise.all([
        readRegularReleaseFile(paths.packageManifestPath, maximumJsonBytes),
        readRegularReleaseFile(paths.cliPackageManifestPath, maximumJsonBytes),
        readRegularReleaseFile(paths.workflowPath, maximumWorkflowBytes),
        readRegularReleaseFile(receiptPath, maximumReceiptBytes),
      ]);
  } catch {
    fail();
  }
  const files = {
    rootPackage: snapshot(paths.packageManifestPath, rootPackageContents, maximumJsonBytes),
    cliPackage: snapshot(paths.cliPackageManifestPath, cliPackageContents, maximumJsonBytes),
    workflow: snapshot(paths.workflowPath, workflowContents, maximumWorkflowBytes),
    receipt: snapshot(receiptPath, receiptContents, maximumReceiptBytes),
  };
  return {
    rootPackage: parseCanonicalJson(rootPackageContents),
    cliPackage: parseCanonicalJson(cliPackageContents),
    workflow: parseWorkflow(workflowContents),
    receipt: parseCanonicalJson(receiptContents),
    sourceSnapshots: files,
    assertUnchanged: () => assertReleaseFilesUnchanged(Object.values(files)),
  };
}
