import { posix } from "node:path";

import type { RepositoryDocumentCapacityPolicy, RepositoryDocumentRole } from "@lervo/project";

import { canonicalJsonBytes, sha256 } from "./hash.js";

export interface DocumentLayoutSnapshotEntry {
  path: string;
  contentHash: string;
  ownership: "user" | "lervo_generated" | "managed_blocks";
}

export type DocumentLayoutOperation =
  | { operationId: string; action: "create" | "update"; path: string; contentHash: string }
  | { operationId: string; action: "delete"; path: string }
  | {
      operationId: string;
      action: "move" | "move_update";
      path: string;
      destinationPath: string;
      contentHash: string;
    };

export type DocumentLayoutBlocker =
  | {
      code: "document_directory_file_capacity_exceeded";
      directory: string;
      observed: number;
      projected: number;
      limit: number;
      operationIds: string[];
    }
  | {
      code: "document_directory_child_capacity_exceeded";
      directory: string;
      observed: number;
      projected: number;
      limit: number;
      operationIds: string[];
    }
  | {
      code: "document_repository_capacity_exceeded";
      observed: number;
      projected: number;
      limit: number;
      operationIds: string[];
    }
  | {
      code: "document_role_conflict";
      scope: string;
      roleId: string;
      candidatePathDigests: string[];
    };

export interface DocumentLayoutCounts {
  repositoryDocuments: number;
  directDocuments: Record<string, number>;
  documentBearingChildDirectories: Record<string, number>;
}

export interface DocumentLayoutEvaluation {
  evaluatorVersion: 1;
  status: "bounded" | "blocked";
  snapshotHash: string;
  policyHash: string;
  roleRegistryHash: string;
  operationSetHash: string;
  observed: DocumentLayoutCounts;
  projected: DocumentLayoutCounts;
  blockers: DocumentLayoutBlocker[];
}

export interface DocumentLayoutPermit {
  schemaVersion: 1;
  permitId: string;
  evaluatorVersion: 1;
  snapshotHash: string;
  policyHash: string;
  roleRegistryHash: string;
  operationSetHash: string;
  projectedCountsHash: string;
  issuedAt: string;
  expiresAt: string;
}

function documentPath(path: string): boolean {
  return /\.mdx?$/iu.test(path);
}

function sortedSnapshot(
  entries: readonly DocumentLayoutSnapshotEntry[],
): DocumentLayoutSnapshotEntry[] {
  return entries
    .filter((entry) => documentPath(entry.path))
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sortedOperations(
  operations: readonly DocumentLayoutOperation[],
): DocumentLayoutOperation[] {
  return operations
    .filter(
      (operation) =>
        documentPath(operation.path) ||
        ("destinationPath" in operation && documentPath(operation.destinationPath)),
    )
    .map((operation) => ({ ...operation }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
}

function counts(paths: Iterable<string>): DocumentLayoutCounts {
  const documents = [...new Set(paths)].filter(documentPath).sort();
  const direct = new Map<string, number>();
  const childDirectories = new Map<string, Set<string>>();
  for (const path of documents) {
    const directory = posix.dirname(path) === "." ? "." : posix.dirname(path);
    direct.set(directory, (direct.get(directory) ?? 0) + 1);
    const segments = directory === "." ? [] : directory.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      const parent = index === 0 ? "." : segments.slice(0, index).join("/");
      const child = segments.slice(0, index + 1).join("/");
      const children = childDirectories.get(parent) ?? new Set<string>();
      children.add(child);
      childDirectories.set(parent, children);
    }
  }
  return {
    repositoryDocuments: documents.length,
    directDocuments: Object.fromEntries(
      [...direct].sort(([left], [right]) => left.localeCompare(right)),
    ),
    documentBearingChildDirectories: Object.fromEntries(
      [...childDirectories]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, children]) => [path, children.size]),
    ),
  };
}

function applicableLimit(
  directory: string,
  policy: RepositoryDocumentCapacityPolicy,
): { maxDirectDocuments: number; maxDocumentBearingChildDirectories: number } {
  const override = policy.overrides
    .filter((item) => directory === item.scopePath || directory.startsWith(`${item.scopePath}/`))
    .sort((left, right) => right.scopePath.length - left.scopePath.length)[0];
  return override ?? policy;
}

function operationsForDirectory(
  directory: string,
  operations: readonly DocumentLayoutOperation[],
): string[] {
  return operations
    .filter((operation) => {
      const paths = [
        operation.path,
        ...("destinationPath" in operation ? [operation.destinationPath] : []),
      ];
      return paths.some((path) => {
        const parent = posix.dirname(path) === "." ? "." : posix.dirname(path);
        return directory === "." || parent === directory || parent.startsWith(`${directory}/`);
      });
    })
    .map((operation) => operation.operationId)
    .sort();
}

function roleBlockers(
  paths: Set<string>,
  roles: readonly RepositoryDocumentRole[],
): DocumentLayoutBlocker[] {
  const blockers: DocumentLayoutBlocker[] = [];
  for (const role of roles.filter((item) => item.required)) {
    const candidates = [role.path, ...(role.legacyAliases ?? [])].filter((path) => paths.has(path));
    if (candidates.length !== 1)
      blockers.push({
        code: "document_role_conflict",
        scope: role.scopePath,
        roleId: role.roleId,
        candidatePathDigests: (candidates.length === 0 ? [role.path] : candidates)
          .map((path) => sha256(path))
          .sort(),
      });
  }
  return blockers;
}

export function evaluateDocumentLayout(input: {
  snapshot: readonly DocumentLayoutSnapshotEntry[];
  operations: readonly DocumentLayoutOperation[];
  policy: RepositoryDocumentCapacityPolicy;
  roles: readonly RepositoryDocumentRole[];
}): DocumentLayoutEvaluation {
  const snapshot = sortedSnapshot(input.snapshot);
  const operations = sortedOperations(input.operations);
  const projectedPaths = new Set(snapshot.map((entry) => entry.path));
  for (const operation of operations) {
    if (operation.action === "delete") projectedPaths.delete(operation.path);
    else if (operation.action === "move" || operation.action === "move_update") {
      projectedPaths.delete(operation.path);
      projectedPaths.add(operation.destinationPath);
    } else projectedPaths.add(operation.path);
  }
  const observed = counts(snapshot.map((entry) => entry.path));
  const projected = counts(projectedPaths);
  const blockers: DocumentLayoutBlocker[] = roleBlockers(projectedPaths, input.roles);
  const directories = new Set([
    ...Object.keys(observed.directDocuments),
    ...Object.keys(projected.directDocuments),
    ...Object.keys(observed.documentBearingChildDirectories),
    ...Object.keys(projected.documentBearingChildDirectories),
  ]);
  for (const directory of [...directories].sort()) {
    const limit = applicableLimit(directory, input.policy);
    const observedFiles = observed.directDocuments[directory] ?? 0;
    const projectedFiles = projected.directDocuments[directory] ?? 0;
    if (projectedFiles > limit.maxDirectDocuments)
      blockers.push({
        code: "document_directory_file_capacity_exceeded",
        directory,
        observed: observedFiles,
        projected: projectedFiles,
        limit: limit.maxDirectDocuments,
        operationIds: operationsForDirectory(directory, operations),
      });
    const observedChildren = observed.documentBearingChildDirectories[directory] ?? 0;
    const projectedChildren = projected.documentBearingChildDirectories[directory] ?? 0;
    if (projectedChildren > limit.maxDocumentBearingChildDirectories)
      blockers.push({
        code: "document_directory_child_capacity_exceeded",
        directory,
        observed: observedChildren,
        projected: projectedChildren,
        limit: limit.maxDocumentBearingChildDirectories,
        operationIds: operationsForDirectory(directory, operations),
      });
  }
  if (projected.repositoryDocuments > input.policy.maxRepositoryDocuments)
    blockers.push({
      code: "document_repository_capacity_exceeded",
      observed: observed.repositoryDocuments,
      projected: projected.repositoryDocuments,
      limit: input.policy.maxRepositoryDocuments,
      operationIds: operations.map((operation) => operation.operationId),
    });
  return {
    evaluatorVersion: 1,
    status: blockers.length === 0 ? "bounded" : "blocked",
    snapshotHash: sha256(canonicalJsonBytes(snapshot)),
    policyHash: sha256(canonicalJsonBytes(input.policy)),
    roleRegistryHash: sha256(canonicalJsonBytes(input.roles)),
    operationSetHash: sha256(canonicalJsonBytes(operations)),
    observed,
    projected,
    blockers,
  };
}

export function createDocumentLayoutPermit(
  evaluation: DocumentLayoutEvaluation,
  now = new Date(),
  lifetimeMilliseconds = 5 * 60 * 1000,
): DocumentLayoutPermit {
  if (evaluation.status !== "bounded")
    throw new Error("A blocked document layout cannot issue a permit.");
  const body: Omit<DocumentLayoutPermit, "permitId"> = {
    schemaVersion: 1,
    evaluatorVersion: evaluation.evaluatorVersion,
    snapshotHash: evaluation.snapshotHash,
    policyHash: evaluation.policyHash,
    roleRegistryHash: evaluation.roleRegistryHash,
    operationSetHash: evaluation.operationSetHash,
    projectedCountsHash: sha256(canonicalJsonBytes(evaluation.projected)),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeMilliseconds).toISOString(),
  };
  return { ...body, permitId: `dlp_${sha256(canonicalJsonBytes(body)).slice(7, 31)}` };
}

export function validateDocumentLayoutPermit(input: {
  permit: DocumentLayoutPermit;
  evaluation: DocumentLayoutEvaluation;
  now?: Date;
}): boolean {
  if (input.evaluation.status !== "bounded") return false;
  const issuedAt = Date.parse(input.permit.issuedAt);
  const expiresAt = Date.parse(input.permit.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt)
    return false;
  const expected = createDocumentLayoutPermit(
    input.evaluation,
    new Date(issuedAt),
    expiresAt - issuedAt,
  );
  const now = input.now ?? new Date();
  return expiresAt > now.getTime() && JSON.stringify(expected) === JSON.stringify(input.permit);
}
