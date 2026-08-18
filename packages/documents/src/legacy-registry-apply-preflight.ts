import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import type { LegacyRegistryMigrationPlan } from "@lervo/schemas";

import {
  captureSidecarDirectorySnapshot,
  sameSidecarSnapshot,
} from "./apply-preflight.js";
import { inspectTargetFile, readStableFile } from "./filesystem.js";
import { canonicalJsonBytes, sha256 } from "./hash.js";
import {
  snapshotLegacyMigrationPath,
  type LegacyMigrationPathSnapshot,
} from "./legacy-registry-planning.js";
import { DocumentMigrationError } from "./types.js";

export const LEGACY_MIGRATION_MARKER_PATH = ".lervo/.document-migration.lock";

function stale(message: string): never {
  throw new DocumentMigrationError("plan_stale", message);
}

function samePathSnapshot(
  left: LegacyMigrationPathSnapshot,
  right: LegacyMigrationPathSnapshot,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "missing" && right.kind === "missing") return true;
  if (left.kind === "file" && right.kind === "file") {
    return left.contentHash === right.contentHash && left.byteCount === right.byteCount;
  }
  return left.kind === "unsafe" && right.kind === "unsafe" &&
    left.reasonCode === right.reasonCode;
}

async function requireMissingMarker(root: string): Promise<void> {
  const marker = await inspectTargetFile(root, LEGACY_MIGRATION_MARKER_PATH, 4096);
  if (marker.kind !== "missing") {
    throw new DocumentMigrationError(
      "migration_conflict",
      "완료되지 않은 문서 구조 전환 marker가 이미 있습니다.",
    );
  }
}

export async function revalidateReferencedDocuments(
  root: string,
  plan: LegacyRegistryMigrationPlan,
): Promise<void> {
  for (const reference of plan.referencedDocuments) {
    const current = await snapshotLegacyMigrationPath(root, reference.path, 4 * 1024 * 1024);
    if (!samePathSnapshot(current, reference.snapshot)) {
      stale(`Legacy registry 참조 문서가 dry-run 이후 바뀌었습니다: ${reference.documentId}`);
    }
  }
}

export async function revalidateLegacyRegistryPlanBefore(
  root: string,
  plan: LegacyRegistryMigrationPlan,
): Promise<Uint8Array> {
  await requireMissingMarker(root);
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await readStableFile(root, plan.source.path, 4 * 1024 * 1024);
  } catch (error) {
    throw new DocumentMigrationError(
      "plan_stale",
      "Legacy registry 원본을 현재 snapshot으로 다시 확인할 수 없습니다.",
      { cause: error },
    );
  }
  if (
    sourceBytes.byteLength !== plan.source.byteCount ||
    sha256(sourceBytes) !== plan.source.contentHash
  ) {
    stale("Legacy registry 원본이 dry-run 이후 바뀌었습니다.");
  }
  const archive = await snapshotLegacyMigrationPath(root, plan.archiveTarget.path, 4 * 1024 * 1024);
  if (!samePathSnapshot(archive, plan.archiveTarget.expected)) {
    stale("Legacy registry archive target이 dry-run 이후 바뀌었습니다.");
  }
  const directory = await snapshotLegacyMigrationPath(
    root,
    plan.manifestDirectory.path,
    64 * 1024,
  );
  if (!samePathSnapshot(directory, plan.manifestDirectory.expected)) {
    stale("Document manifest directory가 dry-run 이후 바뀌었습니다.");
  }
  for (const entry of plan.entries) {
    const target = await snapshotLegacyMigrationPath(root, entry.target.path, 64 * 1024);
    if (!samePathSnapshot(target, entry.target.expected)) {
      stale(`Legacy sidecar target이 dry-run 이후 바뀌었습니다: ${entry.documentId}`);
    }
  }
  await revalidateReferencedDocuments(root, plan);
  return sourceBytes;
}

export async function verifyLegacyRegistryReadyForTransition(
  root: string,
  plan: LegacyRegistryMigrationPlan,
): Promise<void> {
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await readStableFile(root, plan.source.path, 4 * 1024 * 1024);
  } catch (error) {
    throw new DocumentMigrationError(
      "plan_stale",
      "Transaction marker 이후 legacy registry 원본을 다시 확인할 수 없습니다.",
      { cause: error },
    );
  }
  if (
    sha256(sourceBytes) !== plan.source.contentHash ||
    sourceBytes.byteLength !== plan.source.byteCount
  ) {
    stale("Transaction marker 이후 legacy registry 원본이 바뀌었습니다.");
  }
  const archive = await snapshotLegacyMigrationPath(root, plan.archiveTarget.path, 4 * 1024 * 1024);
  if (
    archive.kind !== "file" || archive.contentHash !== plan.source.contentHash ||
    archive.byteCount !== plan.source.byteCount
  ) {
    stale("공개 준비한 legacy registry archive가 원본과 다릅니다.");
  }
  const directory = await snapshotLegacyMigrationPath(
    root,
    plan.manifestDirectory.path,
    64 * 1024,
  );
  if (directory.kind !== "missing") {
    stale("Sidecar 공개 전에 document manifest directory가 생겼습니다.");
  }
  await revalidateReferencedDocuments(root, plan);
}

export async function verifyLegacyRegistryPublished(input: {
  root: string;
  plan: LegacyRegistryMigrationPlan;
  expectedSidecars: ReadonlyMap<string, string>;
}): Promise<void> {
  const source = await inspectTargetFile(input.root, input.plan.source.path, 4 * 1024 * 1024);
  if (source.kind !== "missing") {
    stale("Legacy registry 원본 경로가 승인된 처분대로 비활성화되지 않았습니다.");
  }
  const archive = await snapshotLegacyMigrationPath(
    input.root,
    input.plan.archiveTarget.path,
    4 * 1024 * 1024,
  );
  if (
    archive.kind !== "file" ||
    archive.contentHash !== input.plan.source.contentHash ||
    archive.byteCount !== input.plan.source.byteCount
  ) {
    stale("Legacy registry archive를 원본 bytes로 확인할 수 없습니다.");
  }
  const sidecars = await captureSidecarDirectorySnapshot(input.root);
  if (!sameSidecarSnapshot(sidecars, input.expectedSidecars)) {
    stale("공개한 legacy sidecar layout이 승인된 snapshot과 다릅니다.");
  }
  await revalidateReferencedDocuments(input.root, input.plan);
}

export async function legacyRegistrySourceIsMissing(root: string): Promise<boolean> {
  return (await inspectTargetFile(root, ".lervo/documents.yaml", 4 * 1024 * 1024)).kind ===
    "missing";
}

export async function isExactSidecarDirectory(input: {
  root: string;
  expected: ReadonlyMap<string, string>;
}): Promise<boolean> {
  try {
    const snapshot = await captureSidecarDirectorySnapshot(input.root);
    return sameSidecarSnapshot(snapshot, input.expected);
  } catch {
    return false;
  }
}

export function structuralLayoutHash(input: {
  mode: "legacy_registry" | "sharded_manifests";
  sourceRegistryHash?: string;
  sidecars?: ReadonlyMap<string, string>;
}): string {
  return sha256(canonicalJsonBytes({
    mode: input.mode,
    sourceRegistryHash: input.sourceRegistryHash,
    sidecars: input.sidecars === undefined
      ? []
      : [...input.sidecars]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([path, contentHash]) => ({ path, contentHash })),
  }));
}

export async function assertSafeLervoDirectory(root: string): Promise<void> {
  const directory = resolve(root, ".lervo");
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Legacy registry 구조 전환에는 안전한 .lervo 디렉터리가 필요합니다.",
    );
  }
}
