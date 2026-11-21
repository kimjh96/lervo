import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  isKnowledgeConvergenceOwnerHttpStatus,
  KNOWLEDGE_CONVERGENCE_OWNER_FAILURE_CODES,
} from "@lervo/sync-contract";

import type { RepositoryKnowledgeJobAdmission } from "@lervo/repository-knowledge";

import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";

/**
 * The private projection of this host's latest ownership verdict. Commit paths read it so that no
 * host commits knowledge outputs while it does not hold ownership, whichever process observed it.
 */
export const CONVERGENCE_OWNER_FENCE_PATH = ".lervo/state/knowledge/convergence-owner.json";

export interface ConvergenceOwnerFence {
  schemaVersion: 1;
  verdict: ConvergenceOwnerVerdict;
  /** The last holder recorded as `knowledge.convergence.owner.changed`, or null. */
  recordedHolderKey: string | null;
}

const ROLES = new Set([
  "owner",
  "waiting_owner",
  "unverifiable",
  "contended",
  "ineligible",
  "yielding",
]);

function timestampOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function validFence(value: unknown): value is ConvergenceOwnerFence {
  const fence = value as Partial<ConvergenceOwnerFence> | null;
  const verdict = fence?.verdict as Partial<ConvergenceOwnerVerdict> | undefined;
  return (
    fence?.schemaVersion === 1 &&
    (fence.recordedHolderKey === null || typeof fence.recordedHolderKey === "string") &&
    verdict !== undefined &&
    typeof verdict.role === "string" &&
    ROLES.has(verdict.role) &&
    (verdict.mode === "hub" || verdict.mode === "standalone") &&
    (verdict.hostHash === null || typeof verdict.hostHash === "string") &&
    timestampOrNull(verdict.validUntil) &&
    timestampOrNull(verdict.wakeAt) &&
    timestampOrNull(verdict.grantedAt) &&
    timestampOrNull(verdict.yieldUntil) &&
    typeof verdict.observedAt === "string" &&
    // Fences written before ADR-0466 failure causes existed omit both fields.
    (verdict.failureCode === undefined ||
      verdict.failureCode === null ||
      KNOWLEDGE_CONVERGENCE_OWNER_FAILURE_CODES.has(verdict.failureCode)) &&
    (verdict.httpStatus === undefined ||
      verdict.httpStatus === null ||
      isKnowledgeConvergenceOwnerHttpStatus(verdict.httpStatus))
  );
}

/** Missing, oversized, or invalid fences read as null. */
export async function readConvergenceOwnerFence(
  root: string,
): Promise<ConvergenceOwnerFence | null> {
  try {
    const path = resolve(root, CONVERGENCE_OWNER_FENCE_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 8_192) return null;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return validFence(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeConvergenceOwnerFence(
  root: string,
  fence: ConvergenceOwnerFence,
): Promise<void> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Convergence owner fence directory is invalid.");
  }
  const temporary = resolve(directory, `.convergence-owner-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(fence)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, CONVERGENCE_OWNER_FENCE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export type KnowledgeOutputCommitGrant =
  { allowed: true; hostHash: string | null } | { allowed: false; reason: string };

/**
 * Whether this checkout may commit knowledge outputs now. A host that was never configured and
 * never observed keeps the legacy single-host behavior; any configured host needs a current
 * `owner` verdict, and an unreadable configuration refuses.
 */
export async function knowledgeOutputCommitGrant(
  root: string,
  now: number = Date.now(),
): Promise<KnowledgeOutputCommitGrant> {
  const fence = await readConvergenceOwnerFence(root);
  if (fence === null) {
    try {
      if ((await readConvergenceOwnerHost(root)) === null) return { allowed: true, hostHash: null };
    } catch {
      return { allowed: false, reason: "convergence_owner_host_invalid" };
    }
    return { allowed: false, reason: "convergence_owner_unverifiable" };
  }
  const { verdict } = fence;
  if (
    verdict.role !== "owner" ||
    verdict.validUntil === null ||
    Date.parse(verdict.validUntil) <= now
  )
    return {
      allowed: false,
      reason: verdict.role === "owner" ? "convergence_owner_unverifiable" : verdict.reason,
    };
  return { allowed: true, hostHash: verdict.hostHash };
}

/**
 * ADR-0605: whether this host may hold repository knowledge jobs, decided by the same verdict that
 * decides who runs them. Only a host that runs them, or may again in a moment, holds them: an
 * owner, a host never configured for coordination, and the transient roles (`unverifiable`,
 * `yielding`, `contended`). A host another host owns convergence for (`waiting_owner`) or that may
 * not own it at all (`ineligible`, such as Hub mode without a delegation) runs no job (ADR-0597),
 * so it never receives one.
 */
export function repositoryKnowledgeJobAdmission(
  verdict: Pick<ConvergenceOwnerVerdict, "role"> | null,
): RepositoryKnowledgeJobAdmission {
  switch (verdict?.role) {
    case "waiting_owner":
      return { admitted: false, reason: "convergence_owner_elsewhere" };
    case "ineligible":
      return { admitted: false, reason: "convergence_owner_ineligible" };
    default:
      return { admitted: true };
  }
}

/** This checkout's job admission from its recorded owner verdict. */
export async function readRepositoryKnowledgeJobAdmission(
  root: string,
): Promise<RepositoryKnowledgeJobAdmission> {
  const fence = await readConvergenceOwnerFence(root).catch(() => null);
  return repositoryKnowledgeJobAdmission(fence?.verdict ?? null);
}

/** The Git trailer that names the committing host, used by standalone contention detection. */
export const CONVERGENCE_HOST_TRAILER = "Lervo-Convergence-Host";
