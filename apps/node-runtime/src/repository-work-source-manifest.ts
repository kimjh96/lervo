import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS } from "@lervo/schemas";

import type {
  RepositoryWorkChange,
  RepositoryWorkObservation,
} from "./repository-work-observation.js";

export const MAXIMUM_SOURCE_MANIFEST_BYTES = 1_048_576;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const WORKING_DIGEST = /^(?:file:[0-9]+:[a-f0-9]{64}|link:[a-f0-9]{64}|kind:[0-9]+)$/u;

export type SourceCoordinate =
  | { kind: "git_tree"; commit: string }
  | { kind: "working_tree"; digest: string }
  | { kind: "missing" };

export interface RepositoryWorkSourceManifest {
  schemaVersion: 1;
  repositoryRevisionBefore: string;
  repositoryRevisionAfter: string;
  paths: Array<{ path: string; before: SourceCoordinate; after: SourceCoordinate }>;
}

export interface PreparedRepositoryWorkSourceManifest {
  manifest: RepositoryWorkSourceManifest;
  content: Uint8Array;
  contentHash: string;
}

export class RepositoryWorkSourceManifestError extends Error {
  readonly code = "repository_source_manifest_invalid";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryWorkSourceManifestError";
  }
}

function coordinate(observation: RepositoryWorkObservation, path: string): SourceCoordinate {
  const digest = observation.paths.get(path);
  if (digest === "missing") return { kind: "missing" };
  if (digest !== undefined) return { kind: "working_tree", digest };
  return { kind: "git_tree", commit: observation.head };
}

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const observed = Object.keys(value).toSorted();
  const expected = keys.toSorted();
  return (
    observed.length === expected.length && observed.every((key, index) => key === expected[index])
  );
}

function validCoordinate(value: unknown): value is SourceCoordinate {
  if (!record(value)) return false;
  if (value.kind === "git_tree")
    return (
      exactKeys(value, ["kind", "commit"]) &&
      typeof value.commit === "string" &&
      COMMIT.test(value.commit)
    );
  if (value.kind === "working_tree")
    return (
      exactKeys(value, ["kind", "digest"]) &&
      typeof value.digest === "string" &&
      WORKING_DIGEST.test(value.digest)
    );
  return value.kind === "missing" && exactKeys(value, ["kind"]);
}

/** Rejects noncanonical, malformed, or unbounded bytes before a background agent sees source paths. */
export function parseRepositoryWorkSourceManifest(
  content: Uint8Array,
): RepositoryWorkSourceManifest {
  if (content.byteLength === 0 || content.byteLength > MAXIMUM_SOURCE_MANIFEST_BYTES)
    throw new RepositoryWorkSourceManifestError("The source manifest byte count is invalid.");
  let parsed: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf8", { fatal: true }).decode(content);
    parsed = JSON.parse(text);
  } catch {
    throw new RepositoryWorkSourceManifestError("The source manifest is not valid UTF-8 JSON.");
  }
  if (
    !record(parsed) ||
    !exactKeys(parsed, [
      "schemaVersion",
      "repositoryRevisionBefore",
      "repositoryRevisionAfter",
      "paths",
    ]) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.repositoryRevisionBefore !== "string" ||
    !HASH.test(parsed.repositoryRevisionBefore) ||
    typeof parsed.repositoryRevisionAfter !== "string" ||
    !HASH.test(parsed.repositoryRevisionAfter) ||
    parsed.repositoryRevisionBefore === parsed.repositoryRevisionAfter ||
    !Array.isArray(parsed.paths) ||
    parsed.paths.length < 1 ||
    parsed.paths.length > MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS ||
    JSON.stringify(parsed) !== text
  ) {
    throw new RepositoryWorkSourceManifestError("The source manifest structure is invalid.");
  }
  let preceding = "";
  for (const entry of parsed.paths) {
    if (
      !record(entry) ||
      !exactKeys(entry, ["path", "before", "after"]) ||
      typeof entry.path !== "string" ||
      !safePath(entry.path) ||
      entry.path <= preceding ||
      !validCoordinate(entry.before) ||
      !validCoordinate(entry.after) ||
      isDeepStrictEqual(entry.before, entry.after)
    ) {
      throw new RepositoryWorkSourceManifestError("The source manifest path evidence is invalid.");
    }
    preceding = entry.path;
  }
  return parsed as unknown as RepositoryWorkSourceManifest;
}

/** Binds each observed path to the exact Git revision or dirty-byte digest that supplied it. */
export function prepareRepositoryWorkSourceManifest(input: {
  before: RepositoryWorkObservation;
  after: RepositoryWorkObservation;
  change: RepositoryWorkChange;
}): PreparedRepositoryWorkSourceManifest {
  if (
    input.change.repositoryRevisionBefore !== input.before.revision ||
    input.change.repositoryRevisionAfter !== input.after.revision ||
    input.change.changedPaths.length === 0 ||
    input.change.changedPaths.length > MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS ||
    new Set(input.change.changedPaths).size !== input.change.changedPaths.length ||
    input.change.changedPaths.some((path) => !safePath(path))
  ) {
    throw new RepositoryWorkSourceManifestError(
      "The source manifest does not match a bounded exact repository observation.",
    );
  }
  const paths = input.change.changedPaths.toSorted().map((path) => ({
    path,
    before: coordinate(input.before, path),
    after: coordinate(input.after, path),
  }));
  if (paths.some((item) => JSON.stringify(item.before) === JSON.stringify(item.after))) {
    throw new RepositoryWorkSourceManifestError(
      "An observed changed path has identical before and after source coordinates.",
    );
  }
  const manifest: RepositoryWorkSourceManifest = {
    schemaVersion: 1,
    repositoryRevisionBefore: input.before.revision,
    repositoryRevisionAfter: input.after.revision,
    paths,
  };
  const content = Buffer.from(JSON.stringify(manifest), "utf8");
  if (content.byteLength > MAXIMUM_SOURCE_MANIFEST_BYTES) {
    throw new RepositoryWorkSourceManifestError("The source manifest exceeds its byte bound.");
  }
  return {
    manifest,
    content,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
  };
}

/** Rechecks the source evidence immediately before its completion event is committed. */
export function assertPreparedRepositoryWorkSourceManifest(input: {
  prepared: PreparedRepositoryWorkSourceManifest;
  change: RepositoryWorkChange;
}): void {
  const { prepared, change } = input;
  const parsed = parseRepositoryWorkSourceManifest(prepared.content);
  const content = Buffer.from(JSON.stringify(prepared.manifest), "utf8");
  const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (
    prepared.manifest.schemaVersion !== 1 ||
    prepared.manifest.repositoryRevisionBefore !== change.repositoryRevisionBefore ||
    prepared.manifest.repositoryRevisionAfter !== change.repositoryRevisionAfter ||
    prepared.manifest.paths.length !== change.changedPaths.length ||
    prepared.manifest.paths.some(
      (item, index) => item.path !== change.changedPaths.toSorted()[index],
    ) ||
    content.byteLength > MAXIMUM_SOURCE_MANIFEST_BYTES ||
    !content.equals(Buffer.from(prepared.content)) ||
    prepared.contentHash !== contentHash ||
    !isDeepStrictEqual(parsed, prepared.manifest)
  ) {
    throw new RepositoryWorkSourceManifestError(
      "The prepared source manifest differs from the exact repository completion.",
    );
  }
}
