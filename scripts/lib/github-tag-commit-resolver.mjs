import { maximumAnnotatedTagDepth, validateWorkflowReachabilityCommit } from
  "./first-publication-workflow-reachability-contract.mjs";
import { getGitHubApiJson } from "./github-read-only-api.mjs";

function tagObject(response, expectedSha) {
  if (
    response?.sha !== expectedSha || response.object === null ||
    typeof response.object !== "object" ||
    !["commit", "tag"].includes(response.object.type)
  ) return undefined;
  try {
    return {
      type: response.object.type,
      sha: validateWorkflowReachabilityCommit(response.object.sha),
    };
  } catch {
    return undefined;
  }
}

export async function resolveGitHubTagCommit({
  execute,
  repository,
  tagReference,
  environment,
  maximumResponseBytes,
}) {
  if (tagReference.type === "commit") {
    return { kind: "lightweight", annotatedDepth: 0, commit: tagReference.sha };
  }
  const visited = new Set();
  let object = tagReference;
  for (let depth = 1; depth <= maximumAnnotatedTagDepth; depth += 1) {
    if (visited.has(object.sha)) return undefined;
    visited.add(object.sha);
    const response = await getGitHubApiJson(
      execute,
      `repos/${repository}/git/tags/${object.sha}`,
      environment,
      maximumResponseBytes,
    );
    const next = tagObject(response, object.sha);
    if (next === undefined) return undefined;
    if (next.type === "commit") {
      return { kind: "annotated", annotatedDepth: depth, commit: next.sha };
    }
    object = next;
  }
  return undefined;
}
