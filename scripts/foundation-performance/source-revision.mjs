import { foundationSourceRevision } from "../foundation-evidence/source-revision.mjs";

export async function foundationPerformanceSourceRevision(repositoryRoot) {
  return foundationSourceRevision(repositoryRoot);
}
