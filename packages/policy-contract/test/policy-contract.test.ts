import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

import { createRemoteCommand } from "@lervo/remote-command-contract";
import { describe, expect, it } from "vitest";

import {
  assertPolicyApproval,
  assertPolicyApprovalRevocation,
  calculatePolicySnapshotHash,
  createPolicyApproval,
  createPolicyApprovalRevocation,
  createPolicySnapshot,
  createSignedPolicySnapshot,
  policySignatureBytes,
  policySigningBytes,
} from "../src/index.js";

const target = {
  projectId: "prj_policy_contract",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const request = new TextEncoder().encode("This task requires approval.");

function command() {
  return createRemoteCommand({
    idempotencyKey: "idk_policy_contract_01",
    nonce: Buffer.alloc(32, 1).toString("base64url"),
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T00:10:00.000Z",
    target,
    action: {
      kind: "managed_run",
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      request: {
        artifactId: "art_policy_request",
        contentHash: `sha256:${createHash("sha256").update(request).digest("hex")}`,
        byteCount: request.byteLength,
        mediaType: "text/plain; charset=utf-8",
      },
    },
  });
}

function snapshot() {
  return createPolicySnapshot({
    target,
    sequence: 1,
    previousSnapshotId: null,
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T01:00:00.000Z",
    rules: [{
      ruleId: "polr_developer_write",
      roleId: "developer",
      risk: "medium",
      capability: "filesystem.write",
      repositoryPaths: ["src/result.ts"],
      decision: "require_approval",
    }],
  });
}

describe("policy snapshot and approval contract", () => {
  it("binds snapshot, approval and revocation IDs to canonical originals", () => {
    const policy = snapshot();
    const remoteCommand = command();
    const approval = createPolicyApproval({
      repositoryPaths: ["src/result.ts"],
      snapshot: policy,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_contract",
      capability: "filesystem.write",
      approverSubjectHash: `sha256:${"b".repeat(64)}`,
      grantedAt: "2026-08-19T00:01:00.000Z",
      expiresAt: "2026-08-19T00:09:00.000Z",
    });
    const revocation = createPolicyApprovalRevocation({
      approval,
      revokedAt: "2026-08-19T00:02:00.000Z",
      reasonCode: "cancelled",
    });

    expect(policy.snapshotId).toMatch(/^pol_[a-f0-9]{64}$/);
    expect(calculatePolicySnapshotHash(policy)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(approval.approvalId).toMatch(/^apr_[a-f0-9]{64}$/);
    expect(revocation.revocationId).toMatch(/^apv_[a-f0-9]{64}$/);
    expect(() => assertPolicyApproval({
      approval,
      snapshot: policy,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_contract",
    })).not.toThrow();
    expect(() => assertPolicyApprovalRevocation({ revocation, approval })).not.toThrow();

    expect(() => assertPolicyApproval({
      approval: { ...approval, commandHash: `sha256:${"c".repeat(64)}` },
      snapshot: policy,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_contract",
    })).toThrow();
    expect(() => createPolicyApproval({
      snapshot: policy,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_contract",
      capability: "filesystem.write",
      repositoryPaths: ["src/outside-policy.ts"],
      approverSubjectHash: `sha256:${"b".repeat(64)}`,
      grantedAt: "2026-08-19T00:01:00.000Z",
      expiresAt: "2026-08-19T00:09:00.000Z",
    })).toThrow();
    expect(() => assertPolicyApproval({
      approval,
      snapshot: policy,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_other",
    })).toThrow();
  });

  it("rejects ambiguous rule coordinates and non-contiguous snapshot metadata", () => {
    expect(() => createPolicySnapshot({
      target,
      sequence: 1,
      previousSnapshotId: null,
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-19T01:00:00.000Z",
      rules: [
        {
          ruleId: "polr_duplicate_rule_one",
          roleId: "developer",
          risk: "medium",
          capability: "filesystem.write",
          decision: "allow",
        },
        {
          ruleId: "polr_duplicate_rule_two",
          roleId: "developer",
          risk: "medium",
          capability: "filesystem.write",
          decision: "deny",
        },
      ],
    })).toThrow();
    expect(() => createPolicySnapshot({
      target,
      sequence: 2,
      previousSnapshotId: null,
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-19T01:00:00.000Z",
      rules: snapshot().rules,
    })).toThrow();
  });

  it("uses a purpose-specific signature domain", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const policy = snapshot();
    const keyId = "key_policy_contract";
    const signature = sign(null, policySigningBytes({
      purpose: "snapshot",
      original: policy,
      keyId,
    }), privateKey);
    const envelope = createSignedPolicySnapshot({ snapshot: policy, keyId, signature });

    expect(verify(null, policySigningBytes({
      purpose: "snapshot",
      original: policy,
      keyId,
    }), publicKey, policySignatureBytes(envelope))).toBe(true);
    expect(verify(null, policySigningBytes({
      purpose: "approval",
      original: policy,
      keyId,
    }), publicKey, policySignatureBytes(envelope))).toBe(false);
  });
});
