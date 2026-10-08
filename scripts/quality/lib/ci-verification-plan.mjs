import { execFileSync } from "node:child_process";

import { classifyCiChanges } from "./ci-change-classification.mjs";

export const CI_VERIFICATION_CONTRACT = "lervo-ci-v1";
const revisionPattern = /^[a-f0-9]{40}$/u;
export function createCiVerificationPlan({ repositoryRoot, event, expectedRevision = "" }) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  const revision = git(["rev-parse", "HEAD"]).trim();
  if (!revisionPattern.test(revision) || (expectedRevision && expectedRevision !== revision))
    throw new Error("ci_revision_mismatch");
  const eventName = event.eventName;
  const suppliedBase =
    (event.pull_request?.base?.sha ?? event.before ?? event.inputs?.base_sha) || undefined;
  if (suppliedBase && (!revisionPattern.test(suppliedBase) || suppliedBase === revision))
    throw new Error("ci_base_revision_invalid");
  let baseRevision = suppliedBase;
  let paths;
  try {
    if (!revisionPattern.test(baseRevision ?? ""))
      baseRevision = git(["rev-parse", "HEAD^"]).trim();
    git(["cat-file", "-e", `${baseRevision}^{commit}`]);
    if (suppliedBase && suppliedBase !== baseRevision) throw new Error("ci_base_unknown");
    paths = git(["diff", "--no-renames", "--name-only", "-z", baseRevision, revision])
      .split("\0")
      .filter(Boolean);
  } catch {
    paths = null;
    baseRevision = suppliedBase ?? "0".repeat(40);
  }
  const classification = classifyCiChanges(paths, !["push", "pull_request"].includes(eventName));
  return {
    schemaVersion: 1,
    verificationContract: CI_VERIFICATION_CONTRACT,
    revision,
    baseRevision,
    commitHead: event.pull_request?.head?.sha ?? revision,
    ...classification,
    changedPathCount: paths?.length ?? null,
  };
}
