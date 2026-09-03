const commitPattern = /^[a-f0-9]{40}$/u;
const releaseTagPattern = /^v\d+\.\d+\.\d+$/u;

export const maximumAnnotatedTagDepth = 5;
export const maximumRemoteCliPackageBytes = 1024 * 1024;
export const remoteCliPackagePath = "apps/cli/package.json";

export function validateWorkflowReachabilityCommit(commit) {
  if (typeof commit !== "string" || !commitPattern.test(commit)) {
    throw new TypeError("commit is invalid");
  }
  return commit;
}

export function validateWorkflowReachabilityReleaseTag(releaseTag) {
  if (typeof releaseTag !== "string" || !releaseTagPattern.test(releaseTag)) {
    throw new TypeError("release tag is invalid");
  }
  return releaseTag;
}

export function validateGitHubDefaultBranch(defaultBranch) {
  if (
    typeof defaultBranch !== "string" ||
    defaultBranch.length < 1 ||
    defaultBranch.length > 255 ||
    defaultBranch.startsWith("/") ||
    defaultBranch.endsWith("/") ||
    defaultBranch.endsWith(".") ||
    defaultBranch.endsWith(".lock") ||
    defaultBranch.includes("..") ||
    defaultBranch.includes("@{") ||
    defaultBranch.includes("//") ||
    /[\u0000-\u0020~^:?*[\\\u007f]/u.test(defaultBranch)
  )
    throw new TypeError("default branch is invalid");
  return defaultBranch;
}

export function encodeGitHubReferencePath(reference) {
  return reference
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
