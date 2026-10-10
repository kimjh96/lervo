import { realpath } from "node:fs/promises";
import {
  generatedInstructionPaths,
  instructionPathsFor,
  readInstructionSource,
  repositoryFileExists,
  resolveInstructionPrecedence,
  contextQualityTaskDigest,
  type InstructionSource,
} from "@lervo/context";
import { loadProjectManifest } from "@lervo/project";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { canonicalHash } from "@lervo/search";
import type { ContextQualityIngress } from "@lervo/schemas";

/** Current local read authority only. This observation grants no repository-write authority. */
export async function readRepositoryQualitySnapshot(root: string, ingress: ContextQualityIngress) {
  const manifest = await loadProjectManifest(root);
  if (manifest.projectId !== ingress.projectId) throw new TypeError("Project binding changed.");
  const policy = await loadRepositoryKnowledgePolicy(root);
  const nativePaths = instructionPathsFor(ingress.task.targetPaths);
  const paths = [...new Set([...nativePaths, ...(await generatedInstructionPaths(root))])].sort();
  if (paths.length > 64) throw new TypeError("Instruction catalog capacity exceeded.");
  const sources: InstructionSource[] = [];
  for (const path of paths) {
    if (nativePaths.includes(path) && !(await repositoryFileExists(root, path))) continue;
    sources.push(
      await readInstructionSource(root, path, ingress.task.targetPaths, {
        artifactKinds: ingress.task.artifactKinds,
        requestedActions: ingress.task.requestedActions,
        taskDigest: contextQualityTaskDigest(ingress),
      }),
    );
  }
  const scopeDigest = canonicalHash({
    root: await realpath(root),
    manifest,
    paths: ingress.task.targetPaths,
    authority: "current_local_repository_read_v1",
  });
  return {
    scopeDigest,
    policySetDigest: canonicalHash({
      policy,
      sources: sources.map(({ path, contentHash }) => ({ path, contentHash })),
    }),
    sources: resolveInstructionPrecedence(sources),
  };
}
