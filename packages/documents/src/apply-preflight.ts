import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { DocumentMigrationPlan } from "@lervo/schemas";

import { inspectTargetFile, readStableFile } from "./filesystem.js";
import { canonicalJsonBytes, sha256 } from "./hash.js";
import { DocumentMigrationError } from "./types.js";

const DOCUMENT_FILE = /^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.yaml$/;

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function stale(message: string): never {
  throw new DocumentMigrationError("plan_stale", message);
}

export async function revalidateMigrationSources(
  root: string,
  plan: DocumentMigrationPlan,
): Promise<void> {
  const seen = new Set<string>();
  for (const source of plan.sources) {
    if (seen.has(source.path)) stale("Migration plan에 중복 source snapshot이 있습니다.");
    seen.add(source.path);
    let bytes: Uint8Array;
    try {
      bytes = await readStableFile(root, source.path, 4 * 1024 * 1024);
    } catch (error) {
      throw new DocumentMigrationError(
        "plan_stale",
        `Migration source를 현재 snapshot으로 다시 확인할 수 없습니다: ${source.path}`,
        { cause: error },
      );
    }
    if (bytes.byteLength !== source.byteCount || sha256(bytes) !== source.contentHash) {
      stale(`Migration source가 dry-run 이후 바뀌었습니다: ${source.path}`);
    }
  }
  if (plan.candidates.some((candidate) => !seen.has(candidate.sourcePath))) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Migration candidate가 plan에 없는 source를 가리킵니다.",
    );
  }
}

export async function revalidateMigrationTargets(
  root: string,
  plan: DocumentMigrationPlan,
): Promise<void> {
  for (const candidate of plan.candidates) {
    if (candidate.target === null) continue;
    const current = await inspectTargetFile(root, candidate.target.path, 64 * 1024);
    const expected = candidate.target.expected;
    const matches = expected.kind === "missing"
      ? current.kind === "missing"
      : expected.kind === "unsafe"
        ? current.kind === "unsafe" && current.reasonCode === expected.reasonCode
        : current.kind === "file" && current.bytes.byteLength === expected.byteCount &&
          sha256(current.bytes) === expected.contentHash;
    if (!matches) stale(`Sidecar target이 dry-run 이후 바뀌었습니다: ${candidate.target.path}`);
  }
}

export async function captureSidecarDirectorySnapshot(
  root: string,
  ignoredFileName?: string,
): Promise<ReadonlyMap<string, string>> {
  const directory = resolve(root, ".lervo/documents");
  let before;
  try {
    before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error("unsafe document directory");
    }
  } catch (error) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Metadata-only apply에는 안전한 .lervo/documents 디렉터리가 필요합니다.",
      { cause: error },
    );
  }
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 4097) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Document manifest 디렉터리 항목 수 제한을 넘었습니다.",
    );
  }
  const snapshot = new Map<string, string>();
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (entry.name === ignoredFileName) continue;
    if (!entry.isFile() || entry.isSymbolicLink() || !DOCUMENT_FILE.test(entry.name)) {
      throw new DocumentMigrationError(
        "migration_conflict",
        "Document manifest 디렉터리에 계약 밖의 항목이 있습니다.",
      );
    }
    const path = `.lervo/documents/${entry.name}`;
    const bytes = await readStableFile(root, path, 64 * 1024);
    snapshot.set(path, sha256(bytes));
  }
  const after = await lstat(directory, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
  ) {
    stale("Document manifest 디렉터리가 snapshot 중 바뀌었습니다.");
  }
  return snapshot;
}

export function sameSidecarSnapshot(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [path, contentHash] of left) {
    if (right.get(path) !== contentHash) return false;
  }
  return true;
}

export function sidecarSnapshotHash(snapshot: ReadonlyMap<string, string>): string {
  return sha256(canonicalJsonBytes(
    [...snapshot]
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, contentHash]) => ({ path, contentHash })),
  ));
}

export function expectedPublishedSnapshot(
  existing: ReadonlyMap<string, string>,
  created: readonly { path: string; contentHash: string }[],
): ReadonlyMap<string, string> {
  const expected = new Map(existing);
  for (const item of created) {
    if (expected.has(item.path)) {
      throw new DocumentMigrationError(
        "migration_conflict",
        `승인한 sidecar target이 기존 manifest와 겹칩니다: ${basename(item.path)}`,
      );
    }
    expected.set(item.path, item.contentHash);
  }
  return expected;
}
