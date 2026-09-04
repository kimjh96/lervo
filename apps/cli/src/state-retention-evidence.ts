import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths, type StateRetentionEvidence } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import { listCanonicalizationCandidates } from "@lervo/repository-knowledge";
import { visitEventSnapshot } from "@lervo/storage-contract";

async function walkFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return paths.toSorted();
}

async function completedCandidateIds(repositoryRoot: string): Promise<Set<string>> {
  const result = new Set<string>();
  const root = resolve(repositoryRoot, ".lervo/knowledge/document-normalizations");
  for (const path of await walkFiles(root)) {
    const source = await readFile(path, "utf8");
    const match = /^candidateId:\s*(knorm_[a-f0-9]{24})\s*$/mu.exec(source);
    if (match?.[1]) result.add(match[1]);
  }
  return result;
}

async function activeDeliberationIds(repositoryRoot: string): Promise<Set<string>> {
  const result = new Set<string>();
  const root = resolveProjectPaths(repositoryRoot).state;
  for (const path of await walkFiles(resolve(root, "deliberations"))) {
    if (!/(?:checkpoint|lease|transaction)/iu.test(path)) continue;
    const match = /[/\\]deliberations[/\\](dlb_[A-Za-z0-9_-]+)[/\\]/u.exec(path);
    if (match?.[1]) result.add(match[1]);
  }
  return result;
}

export async function inspectStateRetentionEvidence(input: {
  repositoryRoot: string;
  storage: ProjectStorage;
}): Promise<StateRetentionEvidence> {
  const completedDeliberationIds = new Set<string>();
  const latest = input.storage.events.latest();
  if (latest !== null) {
    visitEventSnapshot({
      events: input.storage.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (event.type !== "deliberation.completed") return;
        const id = event.payload.deliberationId;
        if (typeof id === "string") completedDeliberationIds.add(id);
      },
    });
  }
  return {
    completedNormalizationCandidateIds: await completedCandidateIds(input.repositoryRoot),
    completedCanonicalizationCandidateIds: new Set(
      (await listCanonicalizationCandidates(input.repositoryRoot))
        .filter((candidate) => ["promoted", "rejected"].includes(candidate.observedState))
        .map((candidate) => candidate.candidateId),
    ),
    completedDeliberationIds,
    activeDeliberationIds: await activeDeliberationIds(input.repositoryRoot),
  };
}
