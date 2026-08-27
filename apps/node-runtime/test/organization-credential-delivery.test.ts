import { resolve } from "node:path";

import {
  createOrganizationDeploymentPolicy,
  createOrganizationRuntimeCredentialGrant,
} from "@lervo/organization-deployment-contract";
import { loadProjectManifest } from "@lervo/project";
import type { ProjectSyncState } from "@lervo/sync-contract";
import { calculateProjectIdentityHash, planProjectRegistration } from "@lervo/sync-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNodeOrganizationCredentialDelivery,
  openNodeRuntime,
  parseNodeRuntimeConfig,
  ReloadableNodeBearerToken,
} from "../src/index.js";
import {
  availablePort,
  nodeRuntimeDestinationId,
  nodeRuntimeFixture,
  nodeRuntimeHubIdentityHash,
  nodeRuntimeProjectId,
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

const target = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const nodeId = "node_organization01";
const destinationId = "hub:organization";
const currentToken = "runtime-token-current-abcdefghijklmnopqrstuvwxyz";
const candidateToken = "runtime-token-candidate-abcdefghijklmnopqrstuvwxyz";

function policy(project = target) {
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

function grant(
  project = target,
  credentialPolicy = policy(project),
  targetDestinationId = destinationId,
) {
  return createOrganizationRuntimeCredentialGrant({
    policy: credentialPolicy,
    target: project,
    nodeId,
    destinationId: targetDestinationId,
    subjectPrincipalId: "node:organization01",
    permissions: ["sync.write"],
    issuedBy: "operator:security",
    issuedAt: "2026-08-27T00:01:00.000Z",
    notBefore: "2026-08-27T00:01:00.000Z",
    expiresAt: "2026-08-27T01:01:00.000Z",
  });
}

afterEach(removeTemporaryRoots);

describe("installed Node organization credential delivery", () => {
  it("composes file loading and authenticated project registration in the opened runtime", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.organizationCredentials = { nodeId };
    const observedTokens: string[] = [];
    let state: ProjectSyncState | null = null;
    let releaseAuthentication!: () => void;
    const authenticationReleased = new Promise<void>((resolve) => {
      releaseAuthentication = resolve;
    });
    let observeAuthenticationStart!: () => void;
    const authenticationStarted = new Promise<void>((resolve) => {
      observeAuthenticationStart = resolve;
    });
    const runtime = await openNodeRuntime(parseNodeRuntimeConfig(configured, root), {
      createTransport(options) {
        return {
          async registerProject(request) {
            observedTokens.push(options.bearerToken);
            observeAuthenticationStart();
            await authenticationReleased;
            const planned = planProjectRegistration({
              current: state,
              request,
              acceptedAt: "2026-08-27T00:02:01.000Z",
            });
            state = planned.state;
            return {
              authentication: {
                status: "verified" as const,
                destinationId: nodeRuntimeDestinationId,
                peerIdentityHash: nodeRuntimeHubIdentityHash,
              },
              body: planned.response,
            };
          },
          async sendEventBatch() {
            throw new Error("event synchronization is outside this test");
          },
        };
      },
    });
    try {
      await ownerFile(resolve(root, "hub.token"), `${candidateToken}\n`);
      const manifest = await loadProjectManifest(fixture.repositoryRoot);
      const project = {
        projectId: nodeRuntimeProjectId,
        projectIdentityHash: calculateProjectIdentityHash(manifest),
      };
      const currentPolicy = policy(project);
      const request = {
        policy: currentPolicy,
        grant: grant(project, currentPolicy, nodeRuntimeDestinationId),
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:02:00.000Z",
      };
      const pendingDelivery = runtime.deliverOrganizationCredential(request);
      await authenticationStarted;
      await expect(runtime.reloadBearerToken()).rejects.toMatchObject({
        code: "token_reload_failed",
      });
      await expect(runtime.deliverOrganizationCredential(request)).rejects.toMatchObject({
        code: "organization_credential_delivery_failed",
      });
      releaseAuthentication();
      await expect(pendingDelivery).resolves.toMatchObject({
        nodeId,
        destinationId: nodeRuntimeDestinationId,
        target: project,
        secretMaterial: "excluded",
      });
      expect(observedTokens).toEqual([candidateToken]);
    } finally {
      await runtime.close();
    }
  });

  it("keeps the current token until candidate authentication succeeds", async () => {
    const root = await temporaryRoot();
    const tokenFile = resolve(root, "hub.token");
    await ownerFile(tokenFile, `${candidateToken}\n`);
    const bearerToken = new ReloadableNodeBearerToken(currentToken);
    const authenticateCandidate = vi.fn(async (candidate: string) => {
      expect(candidate).toBe(candidateToken);
      expect(bearerToken.current()).toBe(currentToken);
    });
    const delivery = createNodeOrganizationCredentialDelivery({
      binding: { nodeId, destinationId, target, bearerTokenFile: tokenFile },
      bearerToken,
      authenticateCandidate,
    });

    const receipt = await delivery.deliver({
      policy: policy(),
      grant: grant(),
      deliveredBy: "operator:delivery",
      deliveredAt: "2026-08-27T00:02:00.000Z",
    });

    expect(authenticateCandidate).toHaveBeenCalledOnce();
    expect(bearerToken.current()).toBe(candidateToken);
    expect(receipt).toMatchObject({
      nodeId,
      destinationId,
      secretMaterial: "excluded",
    });
    expect(JSON.stringify(receipt)).not.toContain(candidateToken);
  });

  it("retains the current token and creates no receipt when authentication fails", async () => {
    const root = await temporaryRoot();
    const tokenFile = resolve(root, "hub.token");
    await ownerFile(tokenFile, `${candidateToken}\n`);
    const bearerToken = new ReloadableNodeBearerToken(currentToken);
    const delivery = createNodeOrganizationCredentialDelivery({
      binding: { nodeId, destinationId, target, bearerTokenFile: tokenFile },
      bearerToken,
      authenticateCandidate: async () => {
        throw new Error("private authentication failure");
      },
    });

    await expect(
      delivery.deliver({
        policy: policy(),
        grant: grant(),
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "credential_activation_failed" });
    expect(bearerToken.current()).toBe(currentToken);
  });

  it("rejects a credential for another Node before reading or authenticating material", async () => {
    const root = await temporaryRoot();
    const tokenFile = resolve(root, "missing.token");
    const bearerToken = new ReloadableNodeBearerToken(currentToken);
    const authenticateCandidate = vi.fn(async () => undefined);
    const delivery = createNodeOrganizationCredentialDelivery({
      binding: { nodeId: "node_another001", destinationId, target, bearerTokenFile: tokenFile },
      bearerToken,
      authenticateCandidate,
    });

    await expect(
      delivery.deliver({
        policy: policy(),
        grant: grant(),
        deliveredBy: "operator:delivery",
        deliveredAt: "2026-08-27T00:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "organization_credential_delivery_failed" });
    expect(authenticateCandidate).not.toHaveBeenCalled();
    expect(bearerToken.current()).toBe(currentToken);
  });
});
