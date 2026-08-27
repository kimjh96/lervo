import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createOrganizationDeploymentPolicy,
  createOrganizationRuntimeCredentialGrant,
  deliverOrganizationRuntimeCredential,
} from "@lervo/organization-deployment-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OwnerOnlyFileCredentialSourceError,
  OwnerOnlyFileRuntimeCredentialSource,
} from "../src/index.js";

const roots: string[] = [];
const project = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-organization-credential-file-"));
  roots.push(root);
  return root;
}

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
        permissions: ["credential.issue"],
        projectIds: [project.projectId],
      },
    ],
    credentialPolicy: {
      deliveryMode: "runtime_only",
      separationOfDuties: "issuer_and_deliverer_distinct",
      maximumTtlSeconds: 3_600,
      maximumRotationOverlapSeconds: 300,
      allowedPermissions: ["sync.write"],
    },
  });
}

function grant() {
  const currentPolicy = policy();
  return {
    policy: currentPolicy,
    grant: createOrganizationRuntimeCredentialGrant({
      policy: currentPolicy,
      target: project,
      nodeId: "node_organization01",
      destinationId: "hub:organization",
      subjectPrincipalId: "node:organization01",
      permissions: ["sync.write"],
      issuedBy: "operator:security",
      issuedAt: "2026-08-27T00:01:00.000Z",
      notBefore: "2026-08-27T00:01:00.000Z",
      expiresAt: "2026-08-27T01:01:00.000Z",
    }),
  };
}

describe("owner-only file runtime credential source", () => {
  it("delivers exact owner-only bytes through the organization contract", async () => {
    const root = await temporaryRoot();
    const path = resolve(root, "runtime-token");
    const material = "runtime-token-abcdefghijklmnopqrstuvwxyz-0123456789";
    await writeFile(path, `${material}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
    const current = grant();
    const source = new OwnerOnlyFileRuntimeCredentialSource([
      { credentialId: current.grant.credentialId, filePath: path },
    ]);
    let deliveredSecret: Uint8Array | undefined;

    const receipt = await deliverOrganizationRuntimeCredential({
      ...current,
      deliveredBy: "operator:delivery",
      deliveredAt: "2026-08-27T00:02:00.000Z",
      source,
      consumer: {
        activate: async ({ secret }) => {
          deliveredSecret = secret;
          expect(new TextDecoder().decode(secret)).toBe(material);
        },
      },
    });

    expect(deliveredSecret).toBeDefined();
    expect([...(deliveredSecret as Uint8Array)]).toEqual(
      new Array((deliveredSecret as Uint8Array).byteLength).fill(0),
    );
    expect(receipt.secretMaterial).toBe("excluded");
    expect(JSON.stringify(receipt)).not.toContain(path);
    expect(JSON.stringify(receipt)).not.toContain(material);
  });

  it("fails closed for an unbound credential without reading or activating", async () => {
    const current = grant();
    const source = new OwnerOnlyFileRuntimeCredentialSource([
      { credentialId: `ocg_${"b".repeat(64)}`, filePath: "/unobserved/runtime-token" },
    ]);
    const activate = vi.fn(async () => undefined);

    await expect(
      deliverOrganizationRuntimeCredential({
        ...current,
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:02:00.000Z",
        source,
        consumer: { activate },
      }),
    ).rejects.toMatchObject({ code: "credential_source_failed" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("rejects duplicate bindings and unsafe credential files with bounded failures", async () => {
    const current = grant();
    expect(
      () =>
        new OwnerOnlyFileRuntimeCredentialSource([
          { credentialId: current.grant.credentialId, filePath: "/first" },
          { credentialId: current.grant.credentialId, filePath: "/second" },
        ]),
    ).toThrowError(OwnerOnlyFileCredentialSourceError);

    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const path = resolve(root, "runtime-token");
    await writeFile(path, "a".repeat(32), { mode: 0o644 });
    await chmod(path, 0o644);
    const source = new OwnerOnlyFileRuntimeCredentialSource([
      { credentialId: current.grant.credentialId, filePath: path },
    ]);
    await expect(source.load(current.grant.credentialId)).rejects.toMatchObject({
      code: "credential_material_unavailable",
      message: "The requested owner-only credential material is unavailable.",
    });

    const safePath = resolve(root, "safe-token");
    const linkPath = resolve(root, "token-link");
    await writeFile(safePath, "b".repeat(32), { mode: 0o600 });
    await chmod(safePath, 0o600);
    await symlink(safePath, linkPath);
    const linked = new OwnerOnlyFileRuntimeCredentialSource([
      { credentialId: current.grant.credentialId, filePath: linkPath },
    ]);
    await expect(linked.load(current.grant.credentialId)).rejects.toMatchObject({
      code: "credential_material_unavailable",
    });
  });
});
