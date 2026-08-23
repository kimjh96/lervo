import { lstat, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { RepositoryKnowledgeError } from "./types.js";

const ARTIFACT_ID = /^[a-z][a-z0-9_-]*_([a-f0-9]{24,64})$/u;
const SHARD = /^[a-f0-9]{2}$/u;

export function knowledgeArtifactShard(id: string): string {
  const digest = ARTIFACT_ID.exec(id)?.[1];
  if (digest === undefined) {
    throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact ID cannot be mapped to a deterministic shard.");
  }
  return digest.slice(0, 2);
}

export function shardedKnowledgeArtifactPath(directory: string, id: string, extension: "json" | "yaml"): string {
  return `${directory.replace(/\/$/u, "")}/${knowledgeArtifactShard(id)}/${id}.${extension}`;
}

/**
 * Lists canonical two-hex shard paths and, during the v1 transition, legacy flat
 * paths. Callers validate the embedded ID and reject duplicate records.
 */
export async function listKnowledgeArtifactPaths(input: {
  root: string;
  directory: string;
  extension: "json" | "yaml";
  maximumFiles: number;
}): Promise<string[]> {
  const absolute = resolve(input.root, input.directory);
  let entries;
  try {
    const stats = await lstat(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe artifact directory");
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact directory cannot be read safely.");
  }
  const suffix = `.${input.extension}`;
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact directory contains a symbolic link.");
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(`${input.directory}/${entry.name}`);
      continue;
    }
    if (!entry.isDirectory() || !SHARD.test(entry.name)) {
      throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact registry contains an unsupported entry.");
    }
    const children = await readdir(resolve(absolute, entry.name), { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!child.isFile() || child.isSymbolicLink() || !child.name.endsWith(suffix)) {
        throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact shard contains an unsupported entry.");
      }
      const id = basename(child.name, suffix);
      if (knowledgeArtifactShard(id) !== entry.name) {
        throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A knowledge artifact is stored in the wrong shard.");
      }
      files.push(`${input.directory}/${entry.name}/${child.name}`);
    }
  }
  if (files.length > input.maximumFiles) {
    throw new RepositoryKnowledgeError("knowledge_source_limit_exceeded", "The knowledge artifact count exceeds its bounded inventory limit.");
  }
  return files.sort();
}
