import { sha256 } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";
import { defaultGitHubCliExecute, getGitHubApiJson } from "./github-read-only-api.mjs";
import {
  maximumRemoteWorkflowBytes,
  remoteReleaseWorkflowPath,
  validateRemoteWorkflowSourceCommit,
} from "./first-publication-workflow-remote-source-contract.mjs";

export {
  maximumRemoteWorkflowBytes,
  remoteReleaseWorkflowPath,
  validateRemoteWorkflowSourceCommit,
};
const blobShaPattern = /^[a-f0-9]{40}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_repository_workflow",
    state: "unavailable",
    reason,
  };
}

function decodeContent(response) {
  if (
    response?.type !== "file" || response.path !== remoteReleaseWorkflowPath ||
    response.encoding !== "base64" || !Number.isSafeInteger(response.size) ||
    response.size < 1 || response.size > maximumRemoteWorkflowBytes ||
    !blobShaPattern.test(response.sha ?? "") || typeof response.content !== "string" ||
    response.content.includes("\r")
  ) return undefined;
  const encoded = response.content.replaceAll("\n", "");
  if (!base64Pattern.test(encoded)) return undefined;
  const contents = Buffer.from(encoded, "base64");
  if (contents.length !== response.size || contents.toString("base64") !== encoded) {
    return undefined;
  }
  return contents;
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
  const contents = decodeContent(response);
  if (contents === undefined) return unavailable("response_invalid");
  return {
    schemaVersion: 1,
    source: "github_repository_workflow",
    state: "observed",
    repository,
    sourceCommit,
    path: remoteReleaseWorkflowPath,
    blobSha: response.sha,
    byteCount: contents.length,
    sha256: sha256(contents),
    contents,
  };
}
