import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageEvidenceBundleRelativePath } from
  "./first-publication-stage-evidence-bundle.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_evidence_bundle_path_invalid",
    "CLI 최초 게시 stage 증거 묶음 경로가 올바르지 않습니다.",
  );
}

export function makeFirstPublicationStageEvidenceBundleRelativePath(
  manifestPath,
  sourcePath,
) {
  if (!isAbsolute(manifestPath ?? "") || !isAbsolute(sourcePath ?? "")) fail();
  const value = relative(dirname(manifestPath), sourcePath).split(sep).join("/");
  try {
    return validateFirstPublicationStageEvidenceBundleRelativePath(value);
  } catch {
    fail();
  }
}

export function resolveFirstPublicationStageEvidenceBundlePath(
  manifestPath,
  relativePath,
) {
  if (!isAbsolute(manifestPath ?? "")) fail();
  try {
    validateFirstPublicationStageEvidenceBundleRelativePath(relativePath);
  } catch {
    fail();
  }
  const base = dirname(manifestPath);
  const resolved = resolve(base, ...relativePath.split("/"));
  const coordinate = relative(base, resolved).split(sep).join("/");
  if (coordinate !== relativePath) fail();
  return resolved;
}
