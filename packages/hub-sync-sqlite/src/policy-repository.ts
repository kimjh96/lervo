import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import {
  HubPolicyError,
  type HubPolicyBundle,
  type HubPolicyCommandBinding,
  type HubPolicyPublishResult,
} from "@lervo/hub-policy";
import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  assertPolicySnapshot,
  assertSignedPolicyApproval,
  assertSignedPolicyApprovalRevocation,
  assertSignedPolicySnapshot,
} from "@lervo/policy-contract";
import type {
  RemoteCommandTarget,
  SignedPolicyApproval,
  SignedPolicyApprovalRevocation,
  SignedPolicySnapshot,
} from "@lervo/schemas";

import {
  assertPolicyPublishedAt,
  assertRegisteredPolicyProject,
  MAX_POLICY_APPROVALS,
  MAX_POLICY_REVOCATIONS,
} from "./policy-codec.js";
import { HubPolicySQLiteSourceReader } from "./policy-source-reader.js";
import { integerField, stringField } from "./row-codec.js";

export class HubPolicySQLiteRepository {
  private readonly source: HubPolicySQLiteSourceReader;

  constructor(private readonly database: DatabaseSync) {
    this.source = new HubPolicySQLiteSourceReader(database);
  }

  currentSnapshot(destinationId: string, target: RemoteCommandTarget) {
    return this.source.currentSnapshot(destinationId, target);
  }

  command(destinationId: string, target: RemoteCommandTarget, commandId: string) {
    return this.source.command(destinationId, target, commandId);
  }

  approval(destinationId: string, target: RemoteCommandTarget, approvalId: string) {
    return this.source.approval(destinationId, target, approvalId);
  }

  pullBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
  }): HubPolicyBundle | null {
    return this.source.pullBundle(input);
  }

  auditAll(): void {
    this.source.auditAll();
  }

  publishSnapshot(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicySnapshot;
    publishedAt: string;
  }): HubPolicyPublishResult {
    assertRegisteredPolicyProject(this.database, input.destinationId, input.target);
    assertPolicyPublishedAt(input.publishedAt);
    assertSignedPolicySnapshot(input.envelope);
    const snapshot = input.envelope.snapshot;
    assertPolicySnapshot(snapshot);
    if (
      snapshot.target.projectId !== input.target.projectId ||
      snapshot.target.projectIdentityHash !== input.target.projectIdentityHash
    ) {
      throw new HubPolicyError("policy_identity_mismatch", "The policy snapshot target differs from the request.");
    }
    const existing = this.database.prepare(`
      SELECT sequence, snapshot_id, envelope_json, published_at
      FROM hub_policy_snapshots
      WHERE destination_id = ? AND project_id = ?
        AND (snapshot_id = ? OR sequence = ?)
    `).all(input.destinationId, input.target.projectId, snapshot.snapshotId, snapshot.sequence);
    if (existing.length !== 0) {
      if (
        existing.length !== 1 ||
        stringField(existing[0]!, "snapshot_id") !== snapshot.snapshotId ||
        stringField(existing[0]!, "envelope_json") !== canonicalJson(input.envelope)
      ) {
        throw new HubPolicyError("policy_snapshot_conflict", "The policy snapshot sequence conflicts.");
      }
      return {
        status: "duplicate",
        policySnapshotId: snapshot.snapshotId,
        originalId: snapshot.snapshotId,
        publishedAt: stringField(existing[0]!, "published_at"),
      };
    }
    const head = this.source.currentSnapshot(input.destinationId, input.target);
    if (
      snapshot.sequence !== (head?.snapshot.sequence ?? 0) + 1 ||
      snapshot.previousSnapshotId !== (head?.snapshot.snapshotId ?? null)
    ) {
      throw new HubPolicyError("policy_snapshot_conflict", "The policy snapshot continuity coordinates differ from the current Hub head.");
    }
    this.database.prepare(`
      INSERT INTO hub_policy_snapshots (
        destination_id, project_id, sequence, snapshot_id, envelope_json,
        issued_at, expires_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.destinationId,
      input.target.projectId,
      snapshot.sequence,
      snapshot.snapshotId,
      canonicalJson(input.envelope),
      snapshot.issuedAt,
      snapshot.expiresAt,
      input.publishedAt,
    );
    return {
      status: "published",
      policySnapshotId: snapshot.snapshotId,
      originalId: snapshot.snapshotId,
      publishedAt: input.publishedAt,
    };
  }

  publishApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApproval;
    publishedAt: string;
  }): HubPolicyPublishResult {
    assertRegisteredPolicyProject(this.database, input.destinationId, input.target);
    assertPolicyPublishedAt(input.publishedAt);
    assertSignedPolicyApproval(input.envelope);
    const approval = input.envelope.approval;
    const existing = this.database.prepare(`
      SELECT approval_id, snapshot_id, envelope_json, published_at
      FROM hub_policy_approvals
      WHERE destination_id = ? AND project_id = ? AND approval_id = ?
    `).get(input.destinationId, input.target.projectId, approval.approvalId);
    if (existing !== undefined) {
      if (stringField(existing, "envelope_json") !== canonicalJson(input.envelope)) {
        throw new HubPolicyError("policy_snapshot_conflict", "A different source exists for the same policy approval ID.");
      }
      return {
        status: "duplicate",
        policySnapshotId: approval.snapshotId,
        originalId: approval.approvalId,
        publishedAt: stringField(existing, "published_at"),
      };
    }
    const snapshot = this.source.currentSnapshot(input.destinationId, input.target);
    if (snapshot === null || snapshot.snapshot.snapshotId !== approval.snapshotId) {
      throw new HubPolicyError("policy_snapshot_conflict", "The policy approval snapshot is not the current Hub head.");
    }
    const binding = this.source.command(input.destinationId, input.target, approval.commandId);
    if (binding === null) {
      throw new HubPolicyError("policy_command_not_found", "The policy approval command is missing.");
    }
    this.assertApprovalBinding(input.envelope, snapshot, binding);
    const count = integerField(this.database.prepare(`
      SELECT COUNT(*) AS count FROM hub_policy_approvals
      WHERE destination_id = ? AND project_id = ? AND snapshot_id = ?
    `).get(input.destinationId, input.target.projectId, approval.snapshotId)!, "count");
    if (count >= MAX_POLICY_APPROVALS) {
      throw new HubPolicyError("policy_capacity_exceeded", "The policy approval limit for one snapshot was exceeded.");
    }
    this.database.prepare(`
      INSERT INTO hub_policy_approvals (
        approval_id, destination_id, project_id, snapshot_id,
        command_id, envelope_json, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      approval.approvalId,
      input.destinationId,
      input.target.projectId,
      approval.snapshotId,
      approval.commandId,
      canonicalJson(input.envelope),
      input.publishedAt,
    );
    return {
      status: "published",
      policySnapshotId: approval.snapshotId,
      originalId: approval.approvalId,
      publishedAt: input.publishedAt,
    };
  }

  private assertApprovalBinding(
    envelope: SignedPolicyApproval,
    snapshot: SignedPolicySnapshot,
    binding: HubPolicyCommandBinding,
  ): void {
    try {
      assertPolicyApproval({
        approval: envelope.approval,
        snapshot: snapshot.snapshot,
        command: binding.command,
        commandSignerKeyId: binding.commandSignerKeyId,
      });
    } catch (error) {
      throw new HubPolicyError("invalid_policy_request", "The policy approval source relation is invalid.", {
        cause: error,
      });
    }
  }

  publishRevocation(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApprovalRevocation;
    publishedAt: string;
  }): HubPolicyPublishResult {
    assertRegisteredPolicyProject(this.database, input.destinationId, input.target);
    assertPolicyPublishedAt(input.publishedAt);
    assertSignedPolicyApprovalRevocation(input.envelope);
    const revocation = input.envelope.revocation;
    const existing = this.database.prepare(`
      SELECT revocation_id, approval_id, envelope_json, published_at
      FROM hub_policy_revocations
      WHERE destination_id = ? AND project_id = ?
        AND (revocation_id = ? OR approval_id = ?)
    `).all(
      input.destinationId,
      input.target.projectId,
      revocation.revocationId,
      revocation.approvalId,
    );
    if (existing.length !== 0) {
      if (
        existing.length !== 1 ||
        stringField(existing[0]!, "revocation_id") !== revocation.revocationId ||
        stringField(existing[0]!, "envelope_json") !== canonicalJson(input.envelope)
      ) {
        throw new HubPolicyError("policy_snapshot_conflict", "The policy approval has a different revocation.");
      }
      const approval = this.source.approval(
        input.destinationId,
        input.target,
        revocation.approvalId,
      )!;
      return {
        status: "duplicate",
        policySnapshotId: approval.approval.snapshotId,
        originalId: revocation.revocationId,
        publishedAt: stringField(existing[0]!, "published_at"),
      };
    }
    const approval = this.source.approval(
      input.destinationId,
      input.target,
      revocation.approvalId,
    );
    if (approval === null) {
      throw new HubPolicyError("policy_approval_not_found", "The policy approval to revoke is missing.");
    }
    try {
      assertPolicyApprovalRevocation({ revocation, approval: approval.approval });
    } catch (error) {
      throw new HubPolicyError("invalid_policy_request", "The policy revocation source relation is invalid.", {
        cause: error,
      });
    }
    const count = integerField(this.database.prepare(`
      SELECT COUNT(*) AS count FROM hub_policy_revocations AS revocation
      JOIN hub_policy_approvals AS approval
        ON approval.destination_id = revocation.destination_id
       AND approval.project_id = revocation.project_id
       AND approval.approval_id = revocation.approval_id
      WHERE approval.destination_id = ? AND approval.project_id = ?
        AND approval.snapshot_id = ?
    `).get(input.destinationId, input.target.projectId, approval.approval.snapshotId)!, "count");
    if (count >= MAX_POLICY_REVOCATIONS) {
      throw new HubPolicyError("policy_capacity_exceeded", "The policy revocation limit for one snapshot was exceeded.");
    }
    this.database.prepare(`
      INSERT INTO hub_policy_revocations (
        revocation_id, approval_id, destination_id, project_id,
        envelope_json, published_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      revocation.revocationId,
      revocation.approvalId,
      input.destinationId,
      input.target.projectId,
      canonicalJson(input.envelope),
      input.publishedAt,
    );
    return {
      status: "published",
      policySnapshotId: approval.approval.snapshotId,
      originalId: revocation.revocationId,
      publishedAt: input.publishedAt,
    };
  }
}
