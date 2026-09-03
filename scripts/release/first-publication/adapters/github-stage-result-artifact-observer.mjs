import { maximumStageResultArchiveBytes } from "../../lib/bounded-stage-result-archive.mjs";
import {
  defaultGitHubCliExecute,
  getGitHubApiBuffer,
  getGitHubApiJson,
} from "./github-read-only-api.mjs";
import { normalizeGitHubWorkflowArtifact } from "./github-workflow-execution-response.mjs";
import { validateWorkflowExecutionCoordinate } from "../workflow/first-publication-workflow-execution-contract.mjs";
import { validateWorkflowReachabilityCommit } from "../workflow/first-publication-workflow-reachability-contract.mjs";
import { canonicalJson, sha256 } from "../../../shared/release-artifact-manifest.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

const maximumMetadataResponseBytes = 256 * 1024;

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_stage_result_artifact",
    state: "unavailable",
    reason,
  };
}

export async function observeGitHubStageResultArtifact({
  repository,
  sourceCommit,
  runId,
  artifact,
  execute = defaultGitHubCliExecute,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  validateWorkflowReachabilityCommit(sourceCommit);
  validateWorkflowExecutionCoordinate(runId);
  validateWorkflowExecutionCoordinate(artifact?.id);
  const metadataPath = `repos/${repository}/actions/artifacts/${artifact.id}`;
  const metadata = async () =>
    normalizeGitHubWorkflowArtifact(
      await getGitHubApiJson(execute, metadataPath, environment, maximumMetadataResponseBytes),
      artifact.name,
      runId,
      sourceCommit,
    );
  try {
    if (
      !Number.isSafeInteger(artifact.sizeInBytes) ||
      artifact.sizeInBytes <= 0 ||
      artifact.sizeInBytes > maximumStageResultArchiveBytes
    )
      return unavailable("archive_size_invalid");
    const before = await metadata();
    if (before === undefined) return unavailable("response_invalid");
    if (canonicalJson(before) !== canonicalJson(artifact)) {
      return unavailable("artifact_mismatch");
    }
    const contents = await getGitHubApiBuffer(
      execute,
      `${metadataPath}/zip`,
      environment,
      maximumStageResultArchiveBytes,
    );
    if (
      contents.length !== before.sizeInBytes ||
      contents.length <= 0 ||
      contents.length > maximumStageResultArchiveBytes ||
      sha256(contents) !== before.digest
    )
      return unavailable("archive_invalid");
    const after = await metadata();
    if (after === undefined) return unavailable("response_invalid");
    if (canonicalJson(after) !== canonicalJson(before)) {
      return unavailable("artifact_changed");
    }
    return {
      schemaVersion: 1,
      source: "github_stage_result_artifact",
      state: "observed",
      repository,
      sourceCommit,
      runId,
      artifact: before,
      archive: {
        byteCount: contents.length,
        sha256: sha256(contents),
        contents,
      },
      metadataStability: "rechecked_unchanged",
    };
  } catch {
    return unavailable("authentication_or_artifact_unavailable");
  }
}
