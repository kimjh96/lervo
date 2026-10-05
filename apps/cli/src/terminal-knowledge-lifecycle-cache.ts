import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJson,
  sha256,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { readRepositoryFile, repositoryFileExists } from "@lervo/context";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";
import { readCliPackageVersion } from "./version-command.js";

type LifecycleIssue = TerminalLifecycleInspection["issues"][number];

interface TerminalKnowledgeLifecycleCache {
  schemaVersion: 2;
  cliVersion: string;
  repositoryRevision: string;
  supplementalSourcesDigest: string;
  knowledgeProjectionDigest: string;
  issues: LifecycleIssue[];
  /** Agent-owned document drift attention (ADR-0464); never gates lifecycle status. */
  advisories?: LifecycleIssue[];
}

export interface TerminalKnowledgeLifecycleCacheEntry {
  issues: LifecycleIssue[];
  advisories: LifecycleIssue[];
}

const CACHE_PATH = ".lervo/state/terminal-integration/knowledge-lifecycle-cache.json";
const MAXIMUM_CACHE_BYTES = 64 * 1024;
const MAXIMUM_PROJECTION_COORDINATE_BYTES = 512 * 1024;
const KNOWLEDGE_PROJECTION_COORDINATE_PATHS = [
  ".lervo/state/knowledge/current/source-units.json",
  ".lervo/state/knowledge/current/structural/manifests/current.json",
] as const;
const HASH = /^sha256:[a-f0-9]{64}$/u;

function supplementalSourcesDigest(sources: RepositorySupplementalSource[]): string {
  return sha256(
    canonicalJson(
      sources.map((source) => ({
        path: source.path,
        kind: source.kind,
        classification: source.classification,
        contentHash: sha256(source.content),
        origin: source.origin,
        unitKind: source.unitKind,
        locator: source.locator,
        title: source.title,
        adapter: source.adapter,
      })),
    ),
  );
}

async function knowledgeProjectionDigest(root: string): Promise<string | null> {
  const coordinates: Array<{ path: string; contentHash: string | null }> = [];
  for (const path of KNOWLEDGE_PROJECTION_COORDINATE_PATHS) {
    try {
      coordinates.push({
        path,
        contentHash: (await repositoryFileExists(root, path))
          ? sha256(await readRepositoryFile(root, path, MAXIMUM_PROJECTION_COORDINATE_BYTES))
          : null,
      });
    } catch {
      return null;
    }
  }
  return sha256(canonicalJson(coordinates));
}

async function cacheCoordinates(input: {
  root: string;
  repositoryRevision: string;
  supplementalSources: RepositorySupplementalSource[];
}): Promise<Pick<
  TerminalKnowledgeLifecycleCache,
  "cliVersion" | "repositoryRevision" | "supplementalSourcesDigest" | "knowledgeProjectionDigest"
> | null> {
  const projectionDigest = await knowledgeProjectionDigest(input.root);
  if (projectionDigest === null) return null;
  return {
    cliVersion: readCliPackageVersion(),
    repositoryRevision: input.repositoryRevision,
    supplementalSourcesDigest: supplementalSourcesDigest(input.supplementalSources),
    knowledgeProjectionDigest: projectionDigest,
  };
}

function validIssue(value: unknown): value is LifecycleIssue {
  const issue = value as Partial<LifecycleIssue> | null;
  return (
    issue !== null &&
    typeof issue === "object" &&
    typeof issue.code === "string" &&
    issue.code.length >= 1 &&
    issue.code.length <= 128 &&
    typeof issue.command === "string" &&
    issue.command.length >= 1 &&
    issue.command.length <= 512 &&
    (issue.detail === undefined ||
      (typeof issue.detail === "string" && issue.detail.length <= 2 * 1024))
  );
}

function validateCache(value: unknown): TerminalKnowledgeLifecycleCache | null {
  const cache = value as Partial<TerminalKnowledgeLifecycleCache> | null;
  if (
    cache === null ||
    typeof cache !== "object" ||
    cache.schemaVersion !== 2 ||
    typeof cache.cliVersion !== "string" ||
    typeof cache.repositoryRevision !== "string" ||
    !HASH.test(cache.repositoryRevision) ||
    typeof cache.supplementalSourcesDigest !== "string" ||
    !HASH.test(cache.supplementalSourcesDigest) ||
    typeof cache.knowledgeProjectionDigest !== "string" ||
    !HASH.test(cache.knowledgeProjectionDigest) ||
    !Array.isArray(cache.issues) ||
    cache.issues.length > 128 ||
    !cache.issues.every(validIssue) ||
    (cache.advisories !== undefined &&
      (!Array.isArray(cache.advisories) ||
        cache.advisories.length > 32 ||
        !cache.advisories.every(validIssue)))
  ) {
    return null;
  }
  return cache as TerminalKnowledgeLifecycleCache;
}

export async function readTerminalKnowledgeLifecycleCache(input: {
  root: string;
  repositoryRevision: string;
  supplementalSources: RepositorySupplementalSource[];
}): Promise<LifecycleIssue[] | null> {
  return (await readTerminalKnowledgeLifecycleCacheEntry(input))?.issues ?? null;
}

export async function readTerminalKnowledgeLifecycleCacheEntry(input: {
  root: string;
  repositoryRevision: string;
  supplementalSources: RepositorySupplementalSource[];
}): Promise<TerminalKnowledgeLifecycleCacheEntry | null> {
  try {
    const target = resolve(input.root, CACHE_PATH);
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAXIMUM_CACHE_BYTES) return null;
    const cache = validateCache(JSON.parse(await readFile(target, "utf8")));
    if (cache === null) return null;
    const expected = await cacheCoordinates(input);
    if (expected === null) return null;
    if (
      cache.cliVersion !== expected.cliVersion ||
      cache.repositoryRevision !== expected.repositoryRevision ||
      cache.supplementalSourcesDigest !== expected.supplementalSourcesDigest ||
      cache.knowledgeProjectionDigest !== expected.knowledgeProjectionDigest
    ) {
      return null;
    }
    return { issues: cache.issues, advisories: cache.advisories ?? [] };
  } catch {
    return null;
  }
}

export async function writeTerminalKnowledgeLifecycleCache(input: {
  root: string;
  repositoryRevision: string;
  supplementalSources: RepositorySupplementalSource[];
  issues: LifecycleIssue[];
  advisories?: LifecycleIssue[];
}): Promise<void> {
  const advisories = input.advisories ?? [];
  if (
    !HASH.test(input.repositoryRevision) ||
    input.issues.length > 128 ||
    !input.issues.every(validIssue) ||
    advisories.length > 32 ||
    !advisories.every(validIssue)
  ) {
    throw new Error("The terminal knowledge lifecycle cache input is invalid.");
  }
  const coordinates = await cacheCoordinates(input);
  if (coordinates === null)
    throw new Error("The terminal knowledge lifecycle cache coordinates are unavailable.");
  const directory = resolve(input.root, ".lervo/state/terminal-integration");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStats = await lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
    throw new Error("Unsafe terminal knowledge lifecycle cache directory.");
  const cache: TerminalKnowledgeLifecycleCache = {
    schemaVersion: 2,
    ...coordinates,
    issues: input.issues,
    ...(advisories.length === 0 ? {} : { advisories }),
  };
  const bytes = `${JSON.stringify(cache)}\n`;
  if (Buffer.byteLength(bytes) > MAXIMUM_CACHE_BYTES)
    throw new Error("The terminal knowledge lifecycle cache exceeds its storage limit.");
  const temporary = resolve(directory, `.knowledge-lifecycle-${randomUUID()}.tmp`);
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
    await rename(temporary, resolve(input.root, CACHE_PATH));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
