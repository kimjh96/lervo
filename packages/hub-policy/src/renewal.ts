import { createPolicySnapshot } from "@lervo/policy-contract";
import type { RemoteCommandTarget, SignedPolicySnapshot } from "@lervo/schemas";

import { HubPolicyError } from "./errors.js";
import type { HubPolicyPublishResult, HubPolicySigner, HubPolicySourceStore } from "./types.js";

/** A head is re-signed this long before it expires, so a missed cycle still has days to recover. */
export const POLICY_RENEWAL_LEAD_MS = 72 * 60 * 60_000;
/**
 * Approvals bind the exact snapshot and expire with it. While one is live, renewal waits until
 * this close to expiry, so re-signing cuts an approval short by at most this long.
 */
export const POLICY_RENEWAL_APPROVAL_GRACE_MS = 60 * 60_000;

/** The current snapshot of one project and how many unexpired, unrevoked approvals bind it. */
export interface HubPolicyRenewalHead {
  destinationId: string;
  envelope: SignedPolicySnapshot;
  liveApprovalCount: number;
}

export interface HubPolicyRenewalSource {
  listPolicyRenewalHeads(at: string): Promise<HubPolicyRenewalHead[]>;
}

export type HubPolicyRenewalStore = HubPolicyRenewalSource &
  Pick<HubPolicySourceStore, "publishPolicySnapshot">;

export interface HubPolicyRenewalResult {
  renewed: { destinationId: string; projectId: string; snapshotId: string }[];
  /** The earliest time a remaining head becomes due, or null when no project has a policy. */
  nextDueAt: string | null;
}

/** When the head becomes due: the lead before expiry, or the grace while an approval is live. */
export function policyRenewalDueAt(head: HubPolicyRenewalHead): number {
  const expiresAt = Date.parse(head.envelope.snapshot.expiresAt);
  return (
    expiresAt -
    (head.liveApprovalCount === 0 ? POLICY_RENEWAL_LEAD_MS : POLICY_RENEWAL_APPROVAL_GRACE_MS)
  );
}

function renewedSnapshot(head: HubPolicyRenewalHead, signer: HubPolicySigner, at: string) {
  const current = head.envelope.snapshot;
  // The owner chose the validity once; each renewal keeps that length and every rule unchanged.
  const validityMs = Date.parse(current.expiresAt) - Date.parse(current.issuedAt);
  return signer.signSnapshot(
    createPolicySnapshot({
      target: structuredClone(current.target) as RemoteCommandTarget,
      sequence: current.sequence + 1,
      previousSnapshotId: current.snapshotId,
      issuedAt: at,
      expiresAt: new Date(Date.parse(at) + validityMs).toISOString(),
      rules: structuredClone(current.rules),
    }),
  );
}

/**
 * ADR-0609: the Hub re-signs each due head with the same rules and validity length. Publication
 * names the observed head as predecessor, so a concurrent owner change wins and this cycle skips
 * that project. An expired head is renewed too: expiry protects against a missing Hub, and a
 * running Hub with unchanged rules is the owner's current policy.
 */
export async function renewDuePolicySnapshots(input: {
  store: HubPolicyRenewalStore;
  signer: HubPolicySigner;
  now(): string;
}): Promise<HubPolicyRenewalResult> {
  const at = input.now();
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs))
    throw new HubPolicyError("invalid_policy_request", "The policy renewal clock is invalid.");
  const renewed: HubPolicyRenewalResult["renewed"] = [];
  let nextDueMs: number | null = null;
  const remember = (dueMs: number) => {
    nextDueMs = nextDueMs === null ? dueMs : Math.min(nextDueMs, dueMs);
  };
  for (const head of await input.store.listPolicyRenewalHeads(at)) {
    const dueMs = policyRenewalDueAt(head);
    if (dueMs > atMs) {
      remember(dueMs);
      continue;
    }
    const envelope = renewedSnapshot(head, input.signer, at);
    let result: HubPolicyPublishResult;
    try {
      result = await input.store.publishPolicySnapshot({
        destinationId: head.destinationId,
        target: structuredClone(envelope.snapshot.target) as RemoteCommandTarget,
        envelope,
        publishedAt: at,
      });
    } catch (error) {
      if (error instanceof HubPolicyError && error.code === "policy_snapshot_conflict") continue;
      throw error;
    }
    renewed.push({
      destinationId: head.destinationId,
      projectId: envelope.snapshot.target.projectId,
      snapshotId: result.policySnapshotId,
    });
    remember(
      policyRenewalDueAt({ destinationId: head.destinationId, envelope, liveApprovalCount: 0 }),
    );
  }
  return { renewed, nextDueAt: nextDueMs === null ? null : new Date(nextDueMs).toISOString() };
}
