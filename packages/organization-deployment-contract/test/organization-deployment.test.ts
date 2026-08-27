import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  assertOrganizationAuthority,
  assertOrganizationDeploymentPolicy,
  createOrganizationDeploymentPolicy,
  createOrganizationRuntimeCredentialGrant,
  createOrganizationRuntimeCredentialRevocation,
  createSignedOrganizationDeploymentPolicy,
  deliverOrganizationRuntimeCredential,
  organizationDeploymentPolicySigningBytes,
  type RuntimeCredentialConsumer,
  verifySignedOrganizationDeploymentPolicy,
} from "../src/index.js";

const project = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};

function policy() {
  return createOrganizationDeploymentPolicy({
    organizationId: "org_example01",
    sequence: 1,
    previousPolicyId: null,
    issuedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    tenancy: { mode: "strict_project", projects: [project] },
    authorities: [
      {
        principalId: "operator:delivery",
        permissions: ["credential.deliver"],
        projectIds: [project.projectId],
      },
      {
        principalId: "operator:security",
        permissions: ["credential.revoke", "credential.rotate", "credential.issue"],
        projectIds: [project.projectId],
      },
    ],
    credentialPolicy: {
      deliveryMode: "runtime_only",
      separationOfDuties: "issuer_and_deliverer_distinct",
      maximumTtlSeconds: 3_600,
      maximumRotationOverlapSeconds: 300,
      allowedPermissions: ["workstream.write", "sync.write", "workstream.read"],
    },
  });
}

function grant() {
  return createOrganizationRuntimeCredentialGrant({
    policy: policy(),
    target: project,
    nodeId: "node_organization01",
    destinationId: "hub:organization",
    subjectPrincipalId: "node:organization01",
    permissions: ["workstream.write", "sync.write", "workstream.read"],
    issuedBy: "operator:security",
    issuedAt: "2026-08-27T00:01:00.000Z",
    notBefore: "2026-08-27T00:01:00.000Z",
    expiresAt: "2026-08-27T01:01:00.000Z",
  });
}

describe("organization deployment policy", () => {
  it("canonicalizes policy collections and enforces strict project authority", () => {
    const source = policy();
    expect(source.policyId).toMatch(/^odp_[a-f0-9]{64}$/u);
    expect(source.credentialPolicy.allowedPermissions).toEqual([
      "sync.write",
      "workstream.read",
      "workstream.write",
    ]);
    expect(() => assertOrganizationDeploymentPolicy(source)).not.toThrow();
    expect(() =>
      assertOrganizationAuthority({
        policy: source,
        principalId: "operator:security",
        permission: "credential.issue",
        projectId: project.projectId,
        at: "2026-08-27T00:01:00.000Z",
      }),
    ).not.toThrow();
    expect(() =>
      assertOrganizationAuthority({
        policy: source,
        principalId: "operator:delivery",
        permission: "credential.issue",
        projectId: project.projectId,
        at: "2026-08-27T00:01:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "organization_authority_denied" }));
  });

  it("rejects a policy without distinct issuance and delivery authority", () => {
    expect(() =>
      createOrganizationDeploymentPolicy({
        ...policy(),
        sequence: 2,
        previousPolicyId: policy().policyId,
        authorities: [
          {
            principalId: "operator:combined",
            permissions: ["credential.issue", "credential.deliver"],
            projectIds: [project.projectId],
          },
          {
            principalId: "operator:observer",
            permissions: ["deployment.plan"],
            projectIds: [project.projectId],
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_organization_policy" }));
  });

  it("binds organization policy admission to a purpose-specific Ed25519 signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = policy();
    const keyId = "key_organization_policy";
    const envelope = createSignedOrganizationDeploymentPolicy({
      policy: source,
      keyId,
      signature: sign(
        null,
        organizationDeploymentPolicySigningBytes({ policy: source, keyId }),
        privateKey,
      ),
    });
    expect(verifySignedOrganizationDeploymentPolicy({ envelope, publicKey })).toEqual(source);
    expect(() =>
      verifySignedOrganizationDeploymentPolicy({
        envelope,
        publicKey: generateKeyPairSync("ed25519").publicKey,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_organization_policy_signature" }));
  });
});

describe("organization runtime credential lifecycle", () => {
  it("binds rotation to one target, consecutive generation, and bounded overlap", () => {
    const current = grant();
    const rotated = createOrganizationRuntimeCredentialGrant({
      policy: policy(),
      target: project,
      nodeId: current.nodeId,
      destinationId: current.destinationId,
      subjectPrincipalId: current.subjectPrincipalId,
      permissions: current.permissions,
      issuedBy: "operator:security",
      issuedAt: "2026-08-27T00:58:00.000Z",
      notBefore: "2026-08-27T00:58:00.000Z",
      expiresAt: "2026-08-27T01:58:00.000Z",
      previous: current,
    });
    expect(rotated).toMatchObject({
      generation: 2,
      previousCredentialId: current.credentialId,
      material: "runtime_only",
    });
    expect(() =>
      createOrganizationRuntimeCredentialGrant({
        policy: policy(),
        target: project,
        nodeId: current.nodeId,
        destinationId: current.destinationId,
        subjectPrincipalId: current.subjectPrincipalId,
        permissions: current.permissions,
        issuedBy: "operator:security",
        issuedAt: "2026-08-27T00:30:00.000Z",
        notBefore: "2026-08-27T00:30:00.000Z",
        expiresAt: "2026-08-27T01:30:00.000Z",
        previous: current,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_credential_grant" }));
  });

  it("delivers only at runtime, returns secret-free evidence, and clears source bytes", async () => {
    const sourceBytes = new TextEncoder().encode(
      "runtime-token-abcdefghijklmnopqrstuvwxyz-0123456789",
    );
    const activated = vi.fn(
      async ({ secret }: Parameters<RuntimeCredentialConsumer["activate"]>[0]) => {
        expect(new TextDecoder().decode(secret)).toBe(
          "runtime-token-abcdefghijklmnopqrstuvwxyz-0123456789",
        );
      },
    );
    const receipt = await deliverOrganizationRuntimeCredential({
      policy: policy(),
      grant: grant(),
      deliveredBy: "operator:delivery",
      deliveredAt: "2026-08-27T00:02:00.000Z",
      source: { load: async () => sourceBytes },
      consumer: { activate: activated },
    });
    expect(activated).toHaveBeenCalledOnce();
    expect([...sourceBytes]).toEqual(new Array(sourceBytes.byteLength).fill(0));
    expect(receipt).toMatchObject({
      secretMaterial: "excluded",
      deliveredBy: "operator:delivery",
      generation: 1,
    });
    expect(JSON.stringify(receipt)).not.toContain("runtime-token");
  });

  it("refuses revoked credentials before reading secret material", async () => {
    const currentPolicy = policy();
    const currentGrant = grant();
    const revocation = createOrganizationRuntimeCredentialRevocation({
      policy: currentPolicy,
      grant: currentGrant,
      revokedBy: "operator:security",
      revokedAt: "2026-08-27T00:02:00.000Z",
      reason: "compromised",
    });
    const load = vi.fn(async () =>
      new TextEncoder().encode("never-loaded-abcdefghijklmnopqrstuvwxyz"),
    );
    await expect(
      deliverOrganizationRuntimeCredential({
        policy: currentPolicy,
        grant: currentGrant,
        revocations: [revocation],
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:03:00.000Z",
        source: { load },
        consumer: { activate: async () => undefined },
      }),
    ).rejects.toMatchObject({ code: "credential_revoked" });
    expect(load).not.toHaveBeenCalled();
  });

  it("clears credential bytes when runtime activation fails", async () => {
    const sourceBytes = new TextEncoder().encode(
      "runtime-token-abcdefghijklmnopqrstuvwxyz-0123456789",
    );
    await expect(
      deliverOrganizationRuntimeCredential({
        policy: policy(),
        grant: grant(),
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:02:00.000Z",
        source: { load: async () => sourceBytes },
        consumer: {
          activate: async () => {
            throw new Error("private transport failure");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "credential_activation_failed" });
    expect([...sourceBytes]).toEqual(new Array(sourceBytes.byteLength).fill(0));
  });
});
