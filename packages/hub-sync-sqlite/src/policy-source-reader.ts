import type { DatabaseSync } from "node:sqlite";

import {
  HubPolicyError,
  type HubPolicyBundle,
  type HubPolicyCommandBinding,
} from "@lervo/hub-policy";
import { assertPolicyApproval } from "@lervo/policy-contract";
import { calculateRemoteCommandHash } from "@lervo/remote-command-contract";
import type {
  RemoteCommandTarget,
  SignedPolicyApproval,
  SignedPolicySnapshot,
} from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import {
  assertPolicySnapshotTarget,
  assertRegisteredPolicyProject,
  MAX_POLICY_APPROVALS,
  MAX_POLICY_REVOCATIONS,
  parsePolicyApproval,
  parsePolicyRevocation,
  parsePolicySnapshot,
} from "./policy-codec.js";
import { parseStoredRemoteCommandEnvelope } from "./remote-command-row.js";
import { integerField, stringField } from "./row-codec.js";

export class HubPolicySQLiteSourceReader {
  constructor(private readonly database: DatabaseSync) {}

  currentSnapshot(
    destinationId: string,
    target: RemoteCommandTarget,
  ): SignedPolicySnapshot | null {
    assertRegisteredPolicyProject(this.database, destinationId, target);
    const row = this.database.prepare(`
      SELECT sequence, snapshot_id, envelope_json FROM hub_policy_snapshots
      WHERE destination_id = ? AND project_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(destinationId, target.projectId);
    if (row === undefined) return null;
    const envelope = parsePolicySnapshot(row);
    assertPolicySnapshotTarget(envelope, target);
    return envelope;
  }

  command(
    destinationId: string,
    target: RemoteCommandTarget,
    commandId: string,
  ): HubPolicyCommandBinding | null {
    assertRegisteredPolicyProject(this.database, destinationId, target);
    const row = this.database.prepare(`
      SELECT command_id, command_hash, envelope_json FROM hub_remote_commands
      WHERE destination_id = ? AND project_id = ? AND command_id = ?
    `).get(destinationId, target.projectId, commandId);
    if (row === undefined) return null;
    const envelope = parseStoredRemoteCommandEnvelope(row);
    if (
      envelope.command.target.projectIdentityHash !== target.projectIdentityHash ||
      calculateRemoteCommandHash(envelope.command) !== stringField(row, "command_hash")
    ) {
      throw new HubSyncStoreError("integrity_failed", "The policy command source coordinates differ.");
    }
    return {
      command: structuredClone(envelope.command),
      commandSignerKeyId: envelope.signature.keyId,
    };
  }

  approval(
    destinationId: string,
    target: RemoteCommandTarget,
    approvalId: string,
  ): SignedPolicyApproval | null {
    assertRegisteredPolicyProject(this.database, destinationId, target);
    const row = this.database.prepare(`
      SELECT approval.approval_id, approval.snapshot_id, approval.command_id,
        approval.envelope_json, snapshot.sequence,
        snapshot.snapshot_id AS stored_snapshot_id,
        snapshot.envelope_json AS snapshot_envelope_json
      FROM hub_policy_approvals AS approval
      JOIN hub_policy_snapshots AS snapshot
        ON snapshot.destination_id = approval.destination_id
       AND snapshot.project_id = approval.project_id
       AND snapshot.snapshot_id = approval.snapshot_id
      WHERE approval.destination_id = ? AND approval.project_id = ?
        AND approval.approval_id = ?
    `).get(destinationId, target.projectId, approvalId);
    if (row === undefined) return null;
    const snapshot = parsePolicySnapshot({
      sequence: row.sequence,
      snapshot_id: row.stored_snapshot_id,
      envelope_json: row.snapshot_envelope_json,
    });
    assertPolicySnapshotTarget(snapshot, target);
    return parsePolicyApproval(row, snapshot);
  }

  pullBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
  }): HubPolicyBundle | null {
    assertRegisteredPolicyProject(this.database, input.destinationId, input.target);
    const head = this.database.prepare(`
      SELECT sequence, snapshot_id, envelope_json FROM hub_policy_snapshots
      WHERE destination_id = ? AND project_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(input.destinationId, input.target.projectId);
    if (head === undefined) return null;
    let selected = head;
    if (input.currentSnapshotId !== null) {
      const current = this.database.prepare(`
        SELECT sequence, snapshot_id, envelope_json FROM hub_policy_snapshots
        WHERE destination_id = ? AND project_id = ? AND snapshot_id = ?
      `).get(input.destinationId, input.target.projectId, input.currentSnapshotId);
      if (current === undefined) {
        throw new HubPolicyError("policy_snapshot_conflict", "The node policy snapshot cursor was not found on the Hub.");
      }
      if (integerField(current, "sequence") < integerField(head, "sequence")) {
        selected = this.database.prepare(`
          SELECT sequence, snapshot_id, envelope_json FROM hub_policy_snapshots
          WHERE destination_id = ? AND project_id = ? AND sequence = ?
        `).get(
          input.destinationId,
          input.target.projectId,
          integerField(current, "sequence") + 1,
        )!;
      }
    }
    const snapshot = parsePolicySnapshot(selected);
    assertPolicySnapshotTarget(snapshot, input.target);
    const approvalRows = this.database.prepare(`
      SELECT approval_id, snapshot_id, command_id, envelope_json
      FROM hub_policy_approvals
      WHERE destination_id = ? AND project_id = ? AND snapshot_id = ?
      ORDER BY approval_id ASC LIMIT ?
    `).all(
      input.destinationId,
      input.target.projectId,
      snapshot.snapshot.snapshotId,
      MAX_POLICY_APPROVALS + 1,
    );
    if (approvalRows.length > MAX_POLICY_APPROVALS) {
      throw new HubSyncStoreError("integrity_failed", "The stored Hub policy approval limit is corrupted.");
    }
    const approvals = approvalRows.map((row) => parsePolicyApproval(row, snapshot));
    const approvalById = new Map(approvals.map((approval) => [approval.approval.approvalId, approval]));
    const revocationRows = this.database.prepare(`
      SELECT revocation.revocation_id, revocation.approval_id, revocation.envelope_json
      FROM hub_policy_revocations AS revocation
      JOIN hub_policy_approvals AS approval
        ON approval.destination_id = revocation.destination_id
       AND approval.project_id = revocation.project_id
       AND approval.approval_id = revocation.approval_id
      WHERE approval.destination_id = ? AND approval.project_id = ?
        AND approval.snapshot_id = ?
      ORDER BY revocation.revocation_id ASC LIMIT ?
    `).all(
      input.destinationId,
      input.target.projectId,
      snapshot.snapshot.snapshotId,
      MAX_POLICY_REVOCATIONS + 1,
    );
    if (revocationRows.length > MAX_POLICY_REVOCATIONS) {
      throw new HubSyncStoreError("integrity_failed", "The stored Hub policy revocation limit is corrupted.");
    }
    const revocations = revocationRows.map((row) => {
      const approval = approvalById.get(stringField(row, "approval_id"));
      if (approval === undefined) {
        throw new HubSyncStoreError("integrity_failed", "The Hub policy revocation approval source is missing.");
      }
      return parsePolicyRevocation(row, approval);
    });
    return { snapshot, approvals, revocations };
  }

  auditAll(): void {
    const projects = this.database.prepare(`
      SELECT destination_id, project_id, identity_hash FROM hub_projects
      WHERE EXISTS (
        SELECT 1 FROM hub_policy_snapshots AS snapshot
        WHERE snapshot.destination_id = hub_projects.destination_id
          AND snapshot.project_id = hub_projects.project_id
      )
    `).all();
    for (const row of projects) {
      const destinationId = stringField(row, "destination_id");
      const target = {
        projectId: stringField(row, "project_id"),
        projectIdentityHash: stringField(row, "identity_hash"),
      };
      const snapshots = this.database.prepare(`
        SELECT sequence, snapshot_id, envelope_json FROM hub_policy_snapshots
        WHERE destination_id = ? AND project_id = ? ORDER BY sequence ASC
      `).all(destinationId, target.projectId);
      let previousId: string | null = null;
      for (const [index, snapshotRow] of snapshots.entries()) {
        const envelope = parsePolicySnapshot(snapshotRow);
        assertPolicySnapshotTarget(envelope, target);
        if (
          envelope.snapshot.sequence !== index + 1 ||
          envelope.snapshot.previousSnapshotId !== previousId
        ) {
          throw new HubSyncStoreError("integrity_failed", "The Hub policy snapshot chain is invalid.");
        }
        this.auditSnapshotRelations(destinationId, target, envelope);
        previousId = envelope.snapshot.snapshotId;
      }
    }
  }

  private auditSnapshotRelations(
    destinationId: string,
    target: RemoteCommandTarget,
    snapshot: SignedPolicySnapshot,
  ): void {
    const approvalRows = this.database.prepare(`
      SELECT approval_id, snapshot_id, command_id, envelope_json
      FROM hub_policy_approvals
      WHERE destination_id = ? AND project_id = ? AND snapshot_id = ?
      ORDER BY approval_id ASC LIMIT ?
    `).all(destinationId, target.projectId, snapshot.snapshot.snapshotId, MAX_POLICY_APPROVALS + 1);
    if (approvalRows.length > MAX_POLICY_APPROVALS) {
      throw new HubSyncStoreError("integrity_failed", "The stored Hub policy approval limit is corrupted.");
    }
    const approvals = approvalRows.map((row) => {
      const approval = parsePolicyApproval(row, snapshot);
      const binding = this.command(destinationId, target, approval.approval.commandId);
      if (binding === null) {
        throw new HubSyncStoreError("integrity_failed", "The Hub policy approval command source is missing.");
      }
      try {
        assertPolicyApproval({
          approval: approval.approval,
          snapshot: snapshot.snapshot,
          command: binding.command,
          commandSignerKeyId: binding.commandSignerKeyId,
        });
      } catch (error) {
        throw new HubSyncStoreError(
          "integrity_failed",
          "The source relation between the Hub policy approval and command is invalid.",
          { cause: error },
        );
      }
      return approval;
    });
    const approvalById = new Map(
      approvals.map((approval) => [approval.approval.approvalId, approval]),
    );
    const revocationRows = this.database.prepare(`
      SELECT revocation.revocation_id, revocation.approval_id, revocation.envelope_json
      FROM hub_policy_revocations AS revocation
      JOIN hub_policy_approvals AS approval
        ON approval.destination_id = revocation.destination_id
       AND approval.project_id = revocation.project_id
       AND approval.approval_id = revocation.approval_id
      WHERE approval.destination_id = ? AND approval.project_id = ?
        AND approval.snapshot_id = ?
      ORDER BY revocation.revocation_id ASC LIMIT ?
    `).all(destinationId, target.projectId, snapshot.snapshot.snapshotId, MAX_POLICY_REVOCATIONS + 1);
    if (revocationRows.length > MAX_POLICY_REVOCATIONS) {
      throw new HubSyncStoreError("integrity_failed", "The stored Hub policy revocation limit is corrupted.");
    }
    for (const row of revocationRows) {
      const approval = approvalById.get(stringField(row, "approval_id"));
      if (approval === undefined) {
        throw new HubSyncStoreError("integrity_failed", "The Hub policy revocation approval source is missing.");
      }
      parsePolicyRevocation(row, approval);
    }
  }
}
