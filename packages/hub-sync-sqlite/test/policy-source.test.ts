import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  authorPolicyApproval,
  authorPolicyRevocation,
  authorPolicySnapshot,
  hashPolicyApproverSubject,
} from "@lervo/hub-policy";
import { handleProjectRegistration, handleRemoteCommandEnqueue } from "@lervo/hub-sync";
import { Ed25519PolicySigner } from "@lervo/policy";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  databasePath,
  destinationId,
  manifest,
  registerStore,
  removeTemporaryRoots,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

const issuedAt = "2026-08-19T01:00:00.000Z";
const expiresAt = "2026-08-19T02:00:00.000Z";

function writeRule(decision: "allow" | "deny" | "require_approval" = "require_approval") {
  return {
    ruleId: "polr_developer_write",
    roleId: "developer",
    risk: "medium" as const,
    capability: "filesystem.write" as const,
    repositoryPaths: ["src/result.ts"],
    decision,
  };
}

describe("durable Hub policy source", () => {
  it("authors signed snapshot, approval and revocation and recovers the exact bundle", async () => {
    const path = await databasePath();
    const project = manifest("prj_hub_policy_01");
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const policyKeys = generateKeyPairSync("ed25519");
    const commandKeys = generateKeyPairSync("ed25519");
    const policySigner = new Ed25519PolicySigner("key_hub_policy_01", policyKeys.privateKey);
    const commandSigner = new Ed25519RemoteCommandSigner("key_hub_command_01", commandKeys.privateKey);
    let store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const secondaryDestinationId = "hub:policy-secondary";
    await handleProjectRegistration({
      store,
      request: createProjectRegistrationRequest({
        manifest: project,
        destinationId: secondaryDestinationId,
        requestedAt: issuedAt,
      }),
      acceptedAt: issuedAt,
    });

    const snapshot = await authorPolicySnapshot({
      store,
      signer: policySigner,
      request: {
        destinationId,
        target,
        rules: [writeRule()],
        issuedAt,
        expiresAt,
        publishedAt: issuedAt,
      },
    });
    const secondarySnapshot = await authorPolicySnapshot({
      store,
      signer: policySigner,
      request: {
        destinationId: secondaryDestinationId,
        target,
        rules: [writeRule()],
        issuedAt,
        expiresAt,
        publishedAt: issuedAt,
      },
    });
    expect(secondarySnapshot.policySnapshotId).toBe(snapshot.policySnapshotId);
    const command = createRemoteCommand({
      idempotencyKey: "idk_hub_policy_approval_01",
      nonce: Buffer.alloc(32, 4).toString("base64url"),
      issuedAt,
      expiresAt: "2026-08-19T01:30:00.000Z",
      target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_hub_policy_request",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 20,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    await handleRemoteCommandEnqueue({
      store,
      destinationId,
      envelope: commandSigner.sign(command),
      queuedAt: "2026-08-19T01:00:01.000Z",
    });
    await handleRemoteCommandEnqueue({
      store,
      destinationId: secondaryDestinationId,
      envelope: commandSigner.sign(command),
      queuedAt: "2026-08-19T01:00:01.000Z",
    });
    const principalId = "operator:policy-reviewer";
    const approval = await authorPolicyApproval({
      store,
      signer: policySigner,
      request: {
        destinationId,
        target,
        commandId: command.commandId,
        capability: "filesystem.write",
        repositoryPaths: ["src/result.ts"],
        approverSubjectHash: hashPolicyApproverSubject({
          principalId,
          projectIdentityHash: target.projectIdentityHash,
        }),
        grantedAt: "2026-08-19T01:01:00.000Z",
        expiresAt: "2026-08-19T01:20:00.000Z",
        publishedAt: "2026-08-19T01:01:00.000Z",
      },
    });
    const secondaryApproval = await authorPolicyApproval({
      store,
      signer: policySigner,
      request: {
        destinationId: secondaryDestinationId,
        target,
        commandId: command.commandId,
        capability: "filesystem.write",
        repositoryPaths: ["src/result.ts"],
        approverSubjectHash: hashPolicyApproverSubject({
          principalId,
          projectIdentityHash: target.projectIdentityHash,
        }),
        grantedAt: "2026-08-19T01:01:00.000Z",
        expiresAt: "2026-08-19T01:20:00.000Z",
        publishedAt: "2026-08-19T01:01:00.000Z",
      },
    });
    expect(secondaryApproval.originalId).toBe(approval.originalId);
    const revocation = await authorPolicyRevocation({
      store,
      signer: policySigner,
      request: {
        destinationId,
        target,
        approvalId: approval.originalId,
        reasonCode: "cancelled",
        revokedAt: "2026-08-19T01:02:00.000Z",
        publishedAt: "2026-08-19T01:02:00.000Z",
      },
    });
    const secondaryRevocation = await authorPolicyRevocation({
      store,
      signer: policySigner,
      request: {
        destinationId: secondaryDestinationId,
        target,
        approvalId: secondaryApproval.originalId,
        reasonCode: "cancelled",
        revokedAt: "2026-08-19T01:02:00.000Z",
        publishedAt: "2026-08-19T01:02:00.000Z",
      },
    });
    expect(secondaryRevocation.originalId).toBe(revocation.originalId);
    await store.close();

    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    expect(() => database.exec(
      "UPDATE hub_policy_snapshots SET published_at = published_at",
    )).toThrow(/append-only/);
    expect(() => database.exec(
      "UPDATE hub_policy_approvals SET published_at = published_at",
    )).toThrow(/append-only/);
    expect(() => database.exec(
      "UPDATE hub_policy_revocations SET published_at = published_at",
    )).toThrow(/append-only/);
    database.close();

    store = await HubSyncSQLiteStore.open({ path });
    const bundle = await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: snapshot.policySnapshotId,
    });
    expect(bundle).toMatchObject({
      snapshot: { snapshot: { snapshotId: snapshot.policySnapshotId } },
      approvals: [{ approval: { approvalId: approval.originalId } }],
      revocations: [{ revocation: { revocationId: revocation.originalId } }],
    });
    expect(JSON.stringify(bundle)).not.toContain(principalId);
    await expect(store.pullPolicyBundle({
      destinationId: secondaryDestinationId,
      target,
      currentSnapshotId: secondarySnapshot.policySnapshotId,
    })).resolves.toEqual(bundle);
    await expect(store.auditIntegrity()).resolves.toMatchObject({ valid: true });
    await store.close();
  });

  it("serves the next snapshot in sequence and rejects concurrent head conflicts", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_policy_02");
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const keys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_hub_policy_02", keys.privateKey);
    await registerStore(store, project);
    const first = await authorPolicySnapshot({
      store,
      signer,
      request: { destinationId, target, rules: [writeRule()], issuedAt, expiresAt, publishedAt: issuedAt },
    });
    const concurrent = await Promise.allSettled([
      authorPolicySnapshot({
        store,
        signer,
        request: {
          destinationId,
          target,
          rules: [writeRule("deny")],
          issuedAt: "2026-08-19T01:05:00.000Z",
          expiresAt,
          publishedAt: "2026-08-19T01:05:00.000Z",
        },
      }),
      authorPolicySnapshot({
        store,
        signer,
        request: {
          destinationId,
          target,
          rules: [{ ...writeRule("allow"), ruleId: "polr_developer_write_alt" }],
          issuedAt: "2026-08-19T01:06:00.000Z",
          expiresAt,
          publishedAt: "2026-08-19T01:06:00.000Z",
        },
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(concurrent.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "policy_snapshot_conflict" },
    });

    const next = await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: first.policySnapshotId,
    });
    expect(next?.snapshot.snapshot).toMatchObject({
      sequence: 2,
      previousSnapshotId: first.policySnapshotId,
    });
    const fresh = await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: null,
    });
    expect(fresh?.snapshot.snapshot.snapshotId).toBe(next?.snapshot.snapshot.snapshotId);
    await expect(store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: `pol_${"f".repeat(64)}`,
    })).rejects.toMatchObject({ code: "policy_snapshot_conflict" });
    await store.close();
  });
});
