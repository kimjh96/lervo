export const remoteReleaseWorkflowPath = ".github/workflows/cli-release-matrix.yml";
export const maximumRemoteWorkflowBytes = 256 * 1024;

const sourceCommitPattern = /^[a-f0-9]{40}$/u;

export function validateRemoteWorkflowSourceCommit(sourceCommit) {
  if (typeof sourceCommit !== "string" || !sourceCommitPattern.test(sourceCommit)) {
    throw new TypeError("source commit is invalid");
  }
  return sourceCommit;
}
