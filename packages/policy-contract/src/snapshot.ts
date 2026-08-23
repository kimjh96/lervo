import { canonicalJson } from "@lervo/event-contract";
import { type PolicySnapshot, validateSchema } from "@lervo/schemas";

import { PolicyContractError } from "./errors.js";
import { clone, sha256 } from "./shared.js";

export type PolicySnapshotContent = Omit<PolicySnapshot, "snapshotId">;

export function calculatePolicySnapshotId(content: PolicySnapshotContent): string {
  return `pol_${sha256(canonicalJson(clone(content))).slice("sha256:".length)}`;
}

export function createPolicySnapshot(
  input: Omit<PolicySnapshotContent, "schemaVersion">,
): PolicySnapshot {
  const content: PolicySnapshotContent = { schemaVersion: 1, ...clone(input) };
  const snapshot: PolicySnapshot = {
    ...content,
    snapshotId: calculatePolicySnapshotId(content),
  };
  assertPolicySnapshot(snapshot);
  return clone(snapshot);
}

export function assertPolicySnapshot(snapshot: PolicySnapshot): void {
  if (!validateSchema("policySnapshot", snapshot).valid) {
    throw new PolicyContractError("invalid_policy_snapshot", "The policy snapshot contract is invalid.");
  }
  const { snapshotId: _snapshotId, ...content } = snapshot;
  const coordinateSet = new Set<string>();
  const ruleIds = new Set<string>();
  for (const rule of snapshot.rules) {
    const coordinate = `${rule.roleId}\u0000${rule.risk}\u0000${rule.capability}`;
    if (coordinateSet.has(coordinate) || ruleIds.has(rule.ruleId)) {
      throw new PolicyContractError(
        "invalid_policy_snapshot",
        "Policy snapshot rule coordinates or IDs are duplicated.",
      );
    }
    coordinateSet.add(coordinate);
    ruleIds.add(rule.ruleId);
  }
  if (
    snapshot.snapshotId !== calculatePolicySnapshotId(content) ||
    Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.issuedAt) ||
    (snapshot.sequence === 1 && snapshot.previousSnapshotId !== null) ||
    (snapshot.sequence > 1 && snapshot.previousSnapshotId === null) ||
    snapshot.previousSnapshotId === snapshot.snapshotId
  ) {
    throw new PolicyContractError(
      "invalid_policy_snapshot",
      "The policy snapshot ID, interval, or continuity coordinates differ from the source.",
    );
  }
}

export function calculatePolicySnapshotHash(snapshot: PolicySnapshot): string {
  assertPolicySnapshot(snapshot);
  return sha256(canonicalJson(snapshot));
}
