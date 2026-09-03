import { foundationSourceRevision } from "../evidence/source-revision.mjs";

export async function foundationPerformanceSourceRevision(repositoryRoot) {
  return foundationSourceRevision(repositoryRoot);
}
