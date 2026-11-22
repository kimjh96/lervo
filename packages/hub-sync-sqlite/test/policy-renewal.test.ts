import { generateKeyPairSync } from "node:crypto";

import {
  authorPolicyApproval,
  authorPolicyRevocation,
  authorPolicySnapshot,
  hashPolicyApproverSubject,
  POLICY_RENEWAL_APPROVAL_GRACE_MS,
  POLICY_RENEWAL_LEAD_MS,
  renewDuePolicySnapshots,
} from "@lervo/hub-policy";
import { handleRemoteCommandEnqueue } from "@lervo/hub-sync";
import { Ed25519PolicySigner } from "@lervo/policy";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
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
const expiresAt = "2026-09-18T01:00:00.000Z";
const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
const rule = {
  ruleId: "polr_developer_write",
  roleId: "developer",
  risk: "medium" as const,
  capability: "filesystem.write" as const,
  repositoryPaths: ["README.md"],
  decision: "require_approval" as const,
};
const before = (ms: number) => new Date(Date.parse(expiresAt) - ms).toISOString();

async function policyStore(projectId: string) {
  const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
  const project = manifest(projectId);
  await registerStore(store, project);
  const target = { projectId, projectIdentityHash: calculateProjectIdentityHash(project) };
  const signer = new Ed25519PolicySigner(
    "key_hub_policy_renewal",
    generateKeyPairSync("ed25519").privateKey,
  );
  await authorPolicySnapshot({
    store,
    signer,
    request: { destinationId, target, rules: [rule], issuedAt, expiresAt, publishedAt: issuedAt },
  });
  return { store, signer, target };
}

describe("Hub policy renewal (ADR-0609)", () => {
  it("waits until the lead, then re-signs the same rules for the same validity", async () => {
    const { store, signer, target } = await policyStore("prj_hub_policy_renew_01");
    const early = await renewDuePolicySnapshots({
      store,
      signer,
      now: () => before(POLICY_RENEWAL_LEAD_MS + 1),
    });
    expect(early).toEqual({ renewed: [], nextDueAt: before(POLICY_RENEWAL_LEAD_MS) });

    const at = before(POLICY_RENEWAL_LEAD_MS);
    const due = await renewDuePolicySnapshots({ store, signer, now: () => at });
    const head = await store.getCurrentPolicySnapshot({ destinationId, target });
    expect(due.renewed).toEqual([
      { destinationId, projectId: target.projectId, snapshotId: head!.snapshot.snapshotId },
    ]);
    expect(head!.snapshot).toMatchObject({
      sequence: 2,
      issuedAt: at,
      expiresAt: new Date(Date.parse(at) + validityMs).toISOString(),
      rules: [rule],
    });
    expect(due.nextDueAt).toBe(
      new Date(Date.parse(at) + validityMs - POLICY_RENEWAL_LEAD_MS).toISOString(),
    );
    await store.close();
  });

  it("renews an already expired head, because expiry guards only against a missing Hub", async () => {
    const { store, signer, target } = await policyStore("prj_hub_policy_renew_02");
    const at = new Date(Date.parse(expiresAt) + 86_400_000).toISOString();
    await renewDuePolicySnapshots({ store, signer, now: () => at });
    const head = await store.getCurrentPolicySnapshot({ destinationId, target });
    expect(head!.snapshot).toMatchObject({ sequence: 2, issuedAt: at });
    await store.close();
  });

  it("keeps a live approval usable until the grace window; revoked ones do not hold it", async () => {
    const { store, signer, target } = await policyStore("prj_hub_policy_renew_03");
    const commandSigner = new Ed25519RemoteCommandSigner(
      "key_hub_command_renewal",
      generateKeyPairSync("ed25519").privateKey,
    );
    const approve = async (key: string) => {
      const command = createRemoteCommand({
        idempotencyKey: `idk_hub_policy_renewal_${key}`,
        nonce: Buffer.alloc(32, key.length).toString("base64url"),
        issuedAt,
        expiresAt,
        target,
        action: {
          kind: "managed_run",
          roleId: "developer",
          provider: "claude",
          risk: "medium",
          verificationSuiteIds: ["repo.check"],
          request: {
            artifactId: `art_hub_policy_renewal_${key}`,
            contentHash: `sha256:${"b".repeat(64)}`,
            byteCount: 20,
            mediaType: "text/plain; charset=utf-8",
          },
        },
      });
      await handleRemoteCommandEnqueue({
        store,
        destinationId,
        envelope: commandSigner.sign(command),
        queuedAt: issuedAt,
      });
      return authorPolicyApproval({
        store,
        signer,
        request: {
          destinationId,
          target,
          commandId: command.commandId,
          capability: "filesystem.write",
          repositoryPaths: ["README.md"],
          approverSubjectHash: hashPolicyApproverSubject({
            principalId: "operator:policy-reviewer",
            projectIdentityHash: target.projectIdentityHash,
          }),
          grantedAt: issuedAt,
          expiresAt,
          publishedAt: issuedAt,
        },
      });
    };
    const revoked = await approve("revoked");
    await authorPolicyRevocation({
      store,
      signer,
      request: {
        destinationId,
        target,
        approvalId: revoked.originalId,
        reasonCode: "cancelled",
        revokedAt: issuedAt,
        publishedAt: issuedAt,
      },
    });
    expect((await store.listPolicyRenewalHeads(issuedAt))[0]!.liveApprovalCount).toBe(0);
    await approve("live");

    const held = await renewDuePolicySnapshots({
      store,
      signer,
      now: () => before(POLICY_RENEWAL_LEAD_MS),
    });
    expect(held).toEqual({ renewed: [], nextDueAt: before(POLICY_RENEWAL_APPROVAL_GRACE_MS) });
    const due = await renewDuePolicySnapshots({
      store,
      signer,
      now: () => before(POLICY_RENEWAL_APPROVAL_GRACE_MS),
    });
    expect(due.renewed).toHaveLength(1);
    await store.close();
  });

  it("skips a project whose head changed after it was read, so an owner change wins", async () => {
    const { store, signer, target } = await policyStore("prj_hub_policy_renew_04");
    const at = before(POLICY_RENEWAL_LEAD_MS);
    const stale = await store.listPolicyRenewalHeads(at);
    await authorPolicySnapshot({
      store,
      signer,
      request: {
        destinationId,
        target,
        rules: [{ ...rule, decision: "deny" }],
        issuedAt: at,
        expiresAt,
        publishedAt: at,
      },
    });
    const result = await renewDuePolicySnapshots({
      store: {
        listPolicyRenewalHeads: async () => stale,
        publishPolicySnapshot: (input) => store.publishPolicySnapshot(input),
      },
      signer,
      now: () => at,
    });
    expect(result.renewed).toEqual([]);
    const head = await store.getCurrentPolicySnapshot({ destinationId, target });
    expect(head!.snapshot).toMatchObject({ sequence: 2, rules: [{ decision: "deny" }] });
    await store.close();
  });
});

describe("Hub policy renewal of a short policy (ADR-0609)", () => {
  it("renews a one-hour policy at its midpoint, so its successor is not due at once", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_policy_renew_05");
    await registerStore(store, project);
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const signer = new Ed25519PolicySigner(
      "key_hub_policy_short",
      generateKeyPairSync("ed25519").privateKey,
    );
    const shortExpiry = "2026-08-19T02:00:00.000Z";
    await authorPolicySnapshot({
      store,
      signer,
      request: {
        destinationId,
        target,
        rules: [rule],
        issuedAt,
        expiresAt: shortExpiry,
        publishedAt: issuedAt,
      },
    });
    const midpoint = "2026-08-19T01:30:00.000Z";
    const early = await renewDuePolicySnapshots({
      store,
      signer,
      now: () => "2026-08-19T01:29:59.000Z",
    });
    expect(early).toEqual({ renewed: [], nextDueAt: midpoint });
    const due = await renewDuePolicySnapshots({ store, signer, now: () => midpoint });
    expect(due.renewed).toHaveLength(1);
    expect(due.nextDueAt).toBe("2026-08-19T02:00:00.000Z");
    await store.close();
  });
});
