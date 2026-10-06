import { dirname, resolve } from "node:path";

import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

import {
  CONVERGENCE_CONTINUITY_POLICY_FILE,
  parseConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicy,
} from "./continuity-policy.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  createPrivateJsonFile,
  readPrivateJsonFile,
  writePrivateJsonFile,
} from "./private-state-file.js";

const MAXIMUM_POLICY_BYTES = 16 * 1024;

export type ConvergenceContinuityPolicyReading =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "loaded"; policy: ConvergenceContinuityPolicy };

/** The host policy lives beside the host repository registry, outside every checkout. */
export function convergenceContinuityPolicyPath(userStateDirectory: string): string {
  return resolve(userStateDirectory, CONVERGENCE_CONTINUITY_POLICY_FILE);
}

/** The host policy path for this process's user, or null when it cannot be resolved safely. */
export function defaultConvergenceContinuityPolicyPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  try {
    return convergenceContinuityPolicyPath(dirname(defaultRepositoryRegistryPath(environment)));
  } catch {
    return null;
  }
}

export async function readConvergenceContinuityPolicy(
  path: string,
): Promise<ConvergenceContinuityPolicyReading> {
  const file = await readPrivateJsonFile(path, MAXIMUM_POLICY_BYTES);
  if (file.status !== "read") return file;
  try {
    return { status: "loaded", policy: parseConvergenceContinuityPolicy(file.value) };
  } catch {
    return { status: "invalid" };
  }
}

/**
 * Replaces the host policy only when the file still holds `expectedPolicyHash` (null: absent),
 * so two concurrent installs cannot silently overwrite each other.
 */
export async function writeConvergenceContinuityPolicy(input: {
  path: string;
  policy: ConvergenceContinuityPolicy;
  expectedPolicyHash: string | null;
}): Promise<void> {
  const policy = parseConvergenceContinuityPolicy(input.policy);
  const current = await readConvergenceContinuityPolicy(input.path);
  const currentHash = current.status === "loaded" ? current.policy.policyHash : null;
  if (current.status === "invalid" || currentHash !== input.expectedPolicyHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_plan_stale");
  await writePrivateJsonFile(input.path, policy);
}

/** Adopts a policy only on a host that has none, including no revoked one. */
export async function adoptConvergenceContinuityPolicy(
  path: string,
  policy: ConvergenceContinuityPolicy,
): Promise<ConvergenceContinuityPolicyReading> {
  if (await createPrivateJsonFile(path, parseConvergenceContinuityPolicy(policy)))
    return { status: "loaded", policy };
  return readConvergenceContinuityPolicy(path);
}
