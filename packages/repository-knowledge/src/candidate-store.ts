import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";

import { knowledgeArtifactShard, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { validKnowledgeCompilationCandidate } from "./candidate-validation.js";
import { canonicalJson, sha256 } from "./integrity.js";
import type { KnowledgeCompilationCandidate } from "./semantic-compiler.js";
import { RepositoryKnowledgeError } from "./types.js";

export interface KnowledgeCompilationCandidateReceipt {
  schemaVersion: 1;
  compilationId: string;
  sourceSnapshotId: string;
  artifactPath: string;
  artifactHash: string;
  created: boolean;
  assurance: "unreviewed";
}

export interface LoadedKnowledgeCompilationCandidate {
  candidate: KnowledgeCompilationCandidate;
  artifactPath: string;
  artifactHash: string;
}

async function actualDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureCandidateDirectory(root: string): Promise<string> {
  const paths = resolveProjectPaths(root);
  if (!(await actualDirectory(paths.lervoRoot))) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The Lervo project root is not a physical directory.",
    );
  }
  for (const path of [paths.state, paths.knowledgeState, paths.knowledgeCandidates]) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!(await actualDirectory(path))) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "The knowledge candidate storage path is not a physical directory.",
      );
    }
  }
  return paths.knowledgeCandidates;
}

async function readExisting(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("not a regular file");
    return await handle.readFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The existing knowledge candidate artifact cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

export async function storeKnowledgeCompilationCandidate(input: {
  repositoryRoot: string;
  candidate: KnowledgeCompilationCandidate;
}): Promise<KnowledgeCompilationCandidateReceipt> {
  if (!validKnowledgeCompilationCandidate(input.candidate)) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "Only a complete semantic compilation candidate can be stored.",
    );
  }
  const root = resolve(input.repositoryRoot);
  const directory = await ensureCandidateDirectory(root);
  const shard = knowledgeArtifactShard(input.candidate.compilationId);
  const artifactPath = shardedKnowledgeArtifactPath(
    ".lervo/state/knowledge/candidates",
    input.candidate.compilationId,
    "json",
  );
  const shardDirectory = resolve(directory, shard);
  await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
  const absolute = resolve(shardDirectory, `${input.candidate.compilationId}.json`);
  const bytes = Buffer.from(`${canonicalJson(input.candidate)}\n`, "utf8");
  const artifactHash = sha256(bytes);
  const existing = await readExisting(absolute);
  if (existing !== null) {
    if (!existing.equals(bytes)) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "Candidate artifact bytes differ for the same compilation ID.",
      );
    }
    return {
      schemaVersion: 1,
      compilationId: input.candidate.compilationId,
      sourceSnapshotId: input.candidate.sourceSnapshotId,
      artifactPath,
      artifactHash,
      created: false,
      assurance: "unreviewed",
    };
  }
  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raced = await readExisting(absolute);
      if (raced?.equals(bytes)) {
        return {
          schemaVersion: 1,
          compilationId: input.candidate.compilationId,
          sourceSnapshotId: input.candidate.sourceSnapshotId,
          artifactPath,
          artifactHash,
          created: false,
          assurance: "unreviewed",
        };
      }
    }
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge candidate artifact could not be stored.",
    );
  } finally {
    await handle?.close();
  }
  const directoryHandle = await open(shardDirectory, constants.O_RDONLY);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return {
    schemaVersion: 1,
    compilationId: input.candidate.compilationId,
    sourceSnapshotId: input.candidate.sourceSnapshotId,
    artifactPath,
    artifactHash,
    created: true,
    assurance: "unreviewed",
  };
}

export async function loadKnowledgeCompilationCandidate(input: {
  repositoryRoot: string;
  compilationId: string;
}): Promise<LoadedKnowledgeCompilationCandidate> {
  if (!/^kcomp_[a-f0-9]{24}$/.test(input.compilationId)) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge compilation ID is invalid.",
    );
  }
  const root = resolve(input.repositoryRoot);
  const directory = await ensureCandidateDirectory(root);
  const artifactPath = shardedKnowledgeArtifactPath(
    ".lervo/state/knowledge/candidates",
    input.compilationId,
    "json",
  );
  const canonical = resolve(root, artifactPath);
  let bytes = await readExisting(canonical);
  let resolvedArtifactPath = artifactPath;
  const legacyPath = `.lervo/state/knowledge/candidates/${input.compilationId}.json`;
  const legacyBytes = await readExisting(resolve(directory, `${input.compilationId}.json`));
  if (bytes !== null && legacyBytes !== null) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge candidate exists at both legacy and canonical paths.",
    );
  }
  if (bytes === null) {
    bytes = legacyBytes;
    resolvedArtifactPath = legacyPath;
  }
  if (bytes === null || bytes.byteLength > 4 * 1024 * 1024) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge candidate artifact was not found or exceeds the size limit.",
    );
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge candidate artifact is not valid JSON.",
    );
  }
  if (
    !validKnowledgeCompilationCandidate(candidate) ||
    `${canonicalJson(candidate)}\n` !== bytes.toString("utf8")
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The knowledge candidate artifact has invalid identity, provenance, or canonical bytes.",
    );
  }
  return { candidate, artifactPath: resolvedArtifactPath, artifactHash: sha256(bytes) };
}
