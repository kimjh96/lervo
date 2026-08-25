import { sha256 } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";
import { defaultGitHubCliExecute, getGitHubApiJson } from "./github-read-only-api.mjs";
import {
  maximumRemoteWorkflowBytes,
  remoteReleaseWorkflowPath,
  validateRemoteWorkflowSourceCommit,
} from "./first-publication-workflow-remote-source-contract.mjs";
import { normalizeGitHubRepositoryFileResponse } from "./github-repository-file-response.mjs";

export {
  maximumRemoteWorkflowBytes,
  remoteReleaseWorkflowPath,
  validateRemoteWorkflowSourceCommit,
};

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_repository_workflow",
    state: "unavailable",
    reason,
  };
}

export async function observeGitHubWorkflowSource({
  repository,
  sourceCommit,
  execute = defaultGitHubCliExecute,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  validateRemoteWorkflowSourceCommit(sourceCommit);
  let response;
  try {
    response = await getGitHubApiJson(
      execute,
      `repos/${repository}/contents/${remoteReleaseWorkflowPath}?ref=${sourceCommit}`,
      environment,
    );
  } catch {
    return unavailable("authentication_or_workflow_unavailable");
  }
  const file = normalizeGitHubRepositoryFileResponse(response, {
    path: remoteReleaseWorkflowPath,
    maximumBytes: maximumRemoteWorkflowBytes,
  });
  if (file === undefined) return unavailable("response_invalid");
  const { contents } = file;
  return {
    schemaVersion: 1,
    source: "github_repository_workflow",
    state: "observed",
    repository,
    sourceCommit,
    path: remoteReleaseWorkflowPath,
    blobSha: file.blobSha,
    byteCount: contents.length,
    sha256: sha256(contents),
    contents,
  };
}
