import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { syncDirectory } from "@lervo/filesystem-durability";

import {
  durableInstructionCandidateId,
  maximumDurableInstructionCandidateBytes,
  validateDurableInstructionCandidate,
  type DurableInstructionCandidate,
  type DurableInstructionCandidateInspection,
} from "./durable-instruction-candidate.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

const ROOT = ".lervo/state/knowledge/durable-instruction-candidates";
const MAXIMUM_ACTIVE_CANDIDATES = 64;

function candidatePath(candidateId: string): string {
  return `${ROOT}/${candidateId.slice("kinstruction_".length, "kinstruction_".length + 2)}/${candidateId}.json`;
}

async function readCandidateBytes(path: string): Promise<Buffer>;
async function readCandidateBytes(path: string, allowMissing: true): Promise<Buffer | undefined>;
async function readCandidateBytes(path: string, allowMissing = false): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maximumDurableInstructionCandidateBytes) throw new Error();
    return await handle.readFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (allowMissing) return undefined;
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The durable-instruction candidate does not exist.",
      );
    }
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The durable-instruction candidate cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

async function activeCandidatePaths(repositoryRoot: string): Promise<string[]> {
  const directory = resolve(repositoryRoot, ROOT);
  let shards;
  try {
    shards = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const paths: string[] = [];
  for (const shard of shards) {
    if (!shard.isDirectory() || shard.isSymbolicLink() || !/^[a-f0-9]{2}$/u.test(shard.name))
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The durable-instruction candidate registry contains an unsafe shard.",
      );
    for (const entry of await readdir(resolve(directory, shard.name), { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !/^kinstruction_[a-f0-9]{24}\.json$/u.test(entry.name)
      )
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The durable-instruction candidate registry contains an unsafe entry.",
        );
      paths.push(`${ROOT}/${shard.name}/${entry.name}`);
    }
  }
  if (paths.length > MAXIMUM_ACTIVE_CANDIDATES)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `The durable-instruction candidate registry exceeds ${MAXIMUM_ACTIVE_CANDIDATES} active records.`,
    );
  return paths.sort();
}

export async function storeDurableInstructionCandidate(input: {
  repositoryRoot: string;
  candidate: DurableInstructionCandidate;
}): Promise<DurableInstructionCandidateInspection> {
  const root = resolve(input.repositoryRoot);
  validateDurableInstructionCandidate(input.candidate);
  const artifactPath = candidatePath(input.candidate.candidateId);
  const path = resolve(root, artifactPath);
  const bytes = Buffer.from(`${canonicalJson(input.candidate)}\n`);
  if (bytes.byteLength > maximumDurableInstructionCandidateBytes)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The durable-instruction candidate exceeds its storage bound.",
    );
  const existing = await readCandidateBytes(path, true);
  if (existing !== undefined) {
    const stored = validateDurableInstructionCandidate(JSON.parse(existing.toString("utf8")));
    const { createdAt: _storedAt, ...storedIdentity } = stored;
    const { createdAt: _candidateAt, ...candidateIdentity } = input.candidate;
    if (canonicalJson(storedIdentity) !== canonicalJson(candidateIdentity))
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "The durable-instruction candidate identity conflicts with stored bytes.",
      );
    return { ...stored, candidateHash: sha256(existing), artifactPath };
  }
  if ((await activeCandidatePaths(root)).length >= MAXIMUM_ACTIVE_CANDIDATES)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `The durable-instruction candidate registry has ${MAXIMUM_ACTIVE_CANDIDATES} active records. Review or reject one before creating another.`,
    );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await rm(temporary, { force: true });
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
  return { ...input.candidate, candidateHash: sha256(bytes), artifactPath };
}

export async function loadDurableInstructionCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
}): Promise<DurableInstructionCandidateInspection> {
  if (!durableInstructionCandidateId.test(input.candidateId))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The durable-instruction candidate ID is invalid.",
    );
  const artifactPath = candidatePath(input.candidateId);
  const bytes = await readCandidateBytes(resolve(input.repositoryRoot, artifactPath));
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The durable-instruction candidate is not valid JSON.",
    );
  }
  const candidate = validateDurableInstructionCandidate(value);
  if (`${canonicalJson(candidate)}\n` !== bytes.toString("utf8"))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The durable-instruction candidate bytes are not canonical.",
    );
  return { ...candidate, candidateHash: sha256(bytes), artifactPath };
}

export async function listDurableInstructionCandidates(
  repositoryRoot: string,
): Promise<DurableInstructionCandidateInspection[]> {
  return Promise.all(
    (await activeCandidatePaths(resolve(repositoryRoot))).map(async (artifactPath) => {
      const candidateId = artifactPath
        .split("/")
        .at(-1)!
        .replace(/\.json$/u, "");
      return loadDurableInstructionCandidate({ repositoryRoot, candidateId });
    }),
  );
}

export async function removeDurableInstructionCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  expectedCandidateHash: string;
}): Promise<void> {
  const candidate = await loadDurableInstructionCandidate(input);
  if (candidate.candidateHash !== input.expectedCandidateHash)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The durable-instruction candidate changed after review began.",
    );
  const path = resolve(input.repositoryRoot, candidate.artifactPath);
  await rm(path);
  await syncDirectory(dirname(path));
  try {
    if ((await readdir(dirname(path))).length === 0) await rmdir(dirname(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
