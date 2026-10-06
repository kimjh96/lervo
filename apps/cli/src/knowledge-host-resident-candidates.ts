import { realpath } from "node:fs/promises";

import { defaultNodeFleetRegistryPath, listNodeFleetInstances } from "@lervo/repository-registry";
import {
  defaultConvergenceContinuityPolicyPath,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
} from "@lervo/repository-knowledge-runtime";

import { hostRepositoryRoots } from "./knowledge-host-repositories.js";

export type ResidentProvider = "codex" | "claude";

/**
 * The provider a checkout's resident uses: its delegation's, else the active host policy's
 * template provider so it can seed one. Null means continuity has nothing to own here.
 */
export async function residentProvider(
  root: string,
  fallback: ResidentProvider | null,
): Promise<ResidentProvider | null> {
  const delegation = await loadConvergenceDelegation(root).catch(() => null);
  if (delegation !== null)
    return delegation.delegation.state === "revoked" ? null : delegation.delegation.providers[0]!;
  const path = defaultConvergenceContinuityPolicyPath();
  const policy = path === null ? null : await readConvergenceContinuityPolicy(path);
  if (policy?.status !== "loaded" || policy.policy.state !== "active") return null;
  return policy.policy.template?.providers[0] ?? fallback;
}

/** Checkouts served by a registered Node already have that Node's resident. */
export async function nodeServedRoots(): Promise<Set<string>> {
  const instances = await Promise.resolve()
    .then(() => listNodeFleetInstances(defaultNodeFleetRegistryPath()))
    .catch(() => []);
  const roots = await Promise.all(
    instances.map((instance) => realpath(instance.repositoryRoot).catch(() => null)),
  );
  return new Set(roots.filter((root): root is string => root !== null));
}

export interface HostResidentCandidates {
  /** Checkouts the host resident serves, with the provider each resident uses. */
  wanted: Map<string, ResidentProvider>;
  nodeServed: string[];
  notEnrolled: string[];
}

/**
 * ADR-0469/0470: every repository this host knows, split into the ones the host resident serves
 * (no Node, and a delegation or an active policy that can seed one), the ones a Node serves, and
 * the ones continuity does not own.
 */
export async function hostResidentCandidates(
  fallback: ResidentProvider | null,
): Promise<HostResidentCandidates> {
  const served = await nodeServedRoots();
  const result: HostResidentCandidates = { wanted: new Map(), nodeServed: [], notEnrolled: [] };
  for (const root of await hostRepositoryRoots()) {
    if (served.has(root)) {
      result.nodeServed.push(root);
      continue;
    }
    const provider = await residentProvider(root, fallback);
    if (provider === null) result.notEnrolled.push(root);
    else result.wanted.set(root, provider);
  }
  return result;
}
