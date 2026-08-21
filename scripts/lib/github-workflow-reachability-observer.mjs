import {
  defaultGitHubCliExecute,
  getGitHubApiJson,
} from "./github-read-only-api.mjs";
import {
  encodeGitHubReferencePath,
  maximumRemoteCliPackageBytes,
  remoteCliPackagePath,
  validateGitHubDefaultBranch,
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { normalizeGitHubRepositoryFileResponse } from
  "./github-repository-file-response.mjs";
import { resolveGitHubTagCommit } from "./github-tag-commit-resolver.mjs";
import { canonicalJson, sha256 } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const maximumResponseBytes = 2 * 1024 * 1024;

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_repository_reachability",
    state: "unavailable",
    reason,
  };
}

function repositoryMetadata(response) {
  try {
    return { defaultBranch: validateGitHubDefaultBranch(response?.default_branch) };
  } catch {
    return undefined;
  }
}

function reference(response, expectedRef, allowedTypes) {
  if (
    response?.ref !== expectedRef || response.object === null ||
    typeof response.object !== "object" ||
    !allowedTypes.includes(response.object.type)
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

function comparison(response, sourceCommit, defaultHeadCommit) {
  const status = response?.status;
  const aheadBy = response?.ahead_by;
  const behindBy = response?.behind_by;
  if (
    response?.base_commit?.sha !== sourceCommit ||
    !["ahead", "identical", "behind", "diverged"].includes(status) ||
    !Number.isSafeInteger(aheadBy) || aheadBy < 0 ||
    !Number.isSafeInteger(behindBy) || behindBy < 0
  ) return undefined;
  try {
    validateWorkflowReachabilityCommit(response?.merge_base_commit?.sha);
  } catch {
    return undefined;
  }
  const countsMatchTargets = sourceCommit === defaultHeadCommit
    ? aheadBy === 0 && behindBy === 0
    : aheadBy > 0 && behindBy === 0;
  const reachable = response.merge_base_commit.sha === sourceCommit && countsMatchTargets;
  return {
    relation: reachable
      ? "source_commit_ancestor_or_equal"
      : "source_commit_not_ancestor",
    commitsAhead: aheadBy,
  };
}

export async function observeGitHubWorkflowReachability({
  repository,
  sourceCommit,
  releaseTag,
  execute = defaultGitHubCliExecute,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  validateWorkflowReachabilityCommit(sourceCommit);
  validateWorkflowReachabilityReleaseTag(releaseTag);
  const get = (path) => getGitHubApiJson(
    execute,
    path,
    environment,
    maximumResponseBytes,
  );
  try {
    const metadata = repositoryMetadata(await get(`repos/${repository}`));
    if (metadata === undefined) return unavailable("response_invalid");
    const packageFile = normalizeGitHubRepositoryFileResponse(
      await get(
        `repos/${repository}/contents/${remoteCliPackagePath}?ref=${sourceCommit}`,
      ),
      { path: remoteCliPackagePath, maximumBytes: maximumRemoteCliPackageBytes },
    );
    if (packageFile === undefined) return unavailable("response_invalid");
    const branchPath = encodeGitHubReferencePath(metadata.defaultBranch);
    const branchRefPath = `repos/${repository}/git/ref/heads/${branchPath}`;
    const tagRefPath = `repos/${repository}/git/ref/tags/${releaseTag}`;
    const branchRef = reference(
      await get(branchRefPath),
      `refs/heads/${metadata.defaultBranch}`,
      ["commit"],
    );
    const tagRef = reference(
      await get(tagRefPath),
      `refs/tags/${releaseTag}`,
      ["commit", "tag"],
    );
    if (branchRef === undefined || tagRef === undefined) {
      return unavailable("response_invalid");
    }
    const tag = await resolveGitHubTagCommit({
      execute,
      repository,
      tagReference: tagRef,
      environment,
      maximumResponseBytes,
    });
    if (tag === undefined) return unavailable("response_invalid");
    const relation = comparison(
      await get(
        `repos/${repository}/compare/${sourceCommit}...${branchRef.sha}` +
        "?per_page=1&page=1",
      ),
      sourceCommit,
      branchRef.sha,
    );
    if (relation === undefined) return unavailable("response_invalid");
    const [metadataAfter, branchAfter, tagAfter] = await Promise.all([
      get(`repos/${repository}`).then(repositoryMetadata),
      get(branchRefPath).then((value) => reference(
        value,
        `refs/heads/${metadata.defaultBranch}`,
        ["commit"],
      )),
      get(tagRefPath).then((value) => reference(
        value,
        `refs/tags/${releaseTag}`,
        ["commit", "tag"],
      )),
    ]);
    if (
      metadataAfter === undefined || branchAfter === undefined || tagAfter === undefined
    ) return unavailable("response_invalid");
    if (
      canonicalJson(metadataAfter) !== canonicalJson(metadata) ||
      canonicalJson(branchAfter) !== canonicalJson(branchRef) ||
      canonicalJson(tagAfter) !== canonicalJson(tagRef)
    ) return unavailable("references_changed");
    return {
      schemaVersion: 1,
      source: "github_repository_reachability",
      state: "observed",
      repository,
      sourceCommit,
      defaultBranch: {
        name: metadata.defaultBranch,
        headCommit: branchRef.sha,
        ...relation,
      },
      releaseTag: {
        name: releaseTag,
        ...tag,
      },
      sourcePackage: {
        path: remoteCliPackagePath,
        blobSha: packageFile.blobSha,
        byteCount: packageFile.contents.length,
        sha256: sha256(packageFile.contents),
        contents: packageFile.contents,
      },
      referenceStability: "rechecked_unchanged",
    };
  } catch {
    return unavailable("authentication_or_references_unavailable");
  }
}
