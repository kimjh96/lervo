import { resolve } from "node:path";

import {
  applyAuthenticatedOrganizationNodeRollbackDelivery,
  recoverAuthenticatedOrganizationNodeRollbackDelivery,
  type OrganizationNodeRollbackDeliveryReplayStore,
  type OrganizationNodeRolloutDeliveryTrustStore,
  type OrganizationNodeRolloutLocalRollbackPort,
} from "@lervo/organization-deployment-contract";
import { SQLiteOrganizationNodeRollbackReplayStore } from "@lervo/organization-deployment-sqlite";
import { loadProjectManifest } from "@lervo/project";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import { type SignedOrganizationNodeRollbackDelivery, validateSchema } from "@lervo/schemas";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import {
  createInstalledOrganizationNodeRollbackPort,
  type InstalledOrganizationNodeRollbackBinding,
} from "./organization-node-rollback.js";
import { loadOrganizationNodeRolloutTrustStore } from "./organization-node-rollout-delivery.js";

const MAXIMUM_DELIVERY_BYTES = 1_048_576;

export interface InstalledOrganizationNodeRollbackDeliveryInput {
  requestPath: string;
  trustPath: string;
  replayPath: string;
  binding: InstalledOrganizationNodeRollbackBinding;
}

export interface InstalledOrganizationNodeRollbackDeliveryPorts {
  createLocalPort?: (
    binding: InstalledOrganizationNodeRollbackBinding,
  ) => OrganizationNodeRolloutLocalRollbackPort;
  openReplayStore?: (input: {
    path: string;
    target: { projectId: string; projectIdentityHash: string };
    nodeId: string;
    destinationId: string;
  }) => Promise<OrganizationNodeRollbackDeliveryReplayStore & { close(): void }>;
  loadTrustStore?: (path: string) => Promise<OrganizationNodeRolloutDeliveryTrustStore>;
  loadManifest?: typeof loadProjectManifest;
  now?: () => Date;
}

async function loadDelivery(path: string): Promise<SignedOrganizationNodeRollbackDelivery> {
  const value = JSON.parse(
    await readOwnerOnlyText(resolve(path), MAXIMUM_DELIVERY_BYTES),
  ) as unknown;
  if (!validateSchema("signedOrganizationNodeRollbackDelivery", value).valid) {
    throw new Error("The signed organization rollback delivery file is invalid.");
  }
  return structuredClone(value as SignedOrganizationNodeRollbackDelivery);
}

async function runInstalledOrganizationNodeRollbackDelivery(
  input: InstalledOrganizationNodeRollbackDeliveryInput,
  mode: "execute" | "recover",
  ports: InstalledOrganizationNodeRollbackDeliveryPorts = {},
) {
  const [envelope, trustStore, manifest] = await Promise.all([
    loadDelivery(input.requestPath),
    (ports.loadTrustStore ?? loadOrganizationNodeRolloutTrustStore)(input.trustPath),
    (ports.loadManifest ?? loadProjectManifest)(input.binding.repositoryRoot),
  ]);
  const target = {
    projectId: manifest.projectId,
    projectIdentityHash: calculateProjectIdentityHash(manifest),
  };
  const replayStore = await (
    ports.openReplayStore ?? SQLiteOrganizationNodeRollbackReplayStore.open
  )({
    path: input.replayPath,
    target,
    nodeId: input.binding.nodeId,
    destinationId: input.binding.destinationId,
  });
  try {
    const request = {
      envelope,
      nodeId: input.binding.nodeId,
      destinationId: input.binding.destinationId,
      target,
      trustStore,
      replayStore,
      local: (ports.createLocalPort ?? createInstalledOrganizationNodeRollbackPort)(input.binding),
      now: (ports.now ?? (() => new Date()))().toISOString(),
    };
    return mode === "execute"
      ? await applyAuthenticatedOrganizationNodeRollbackDelivery(request)
      : await recoverAuthenticatedOrganizationNodeRollbackDelivery(request);
  } finally {
    replayStore.close();
  }
}

export async function executeInstalledOrganizationNodeRollbackDelivery(
  input: InstalledOrganizationNodeRollbackDeliveryInput,
  ports: InstalledOrganizationNodeRollbackDeliveryPorts = {},
) {
  return (await runInstalledOrganizationNodeRollbackDelivery(input, "execute", ports)) as Awaited<
    ReturnType<typeof applyAuthenticatedOrganizationNodeRollbackDelivery>
  >;
}

export async function recoverInstalledOrganizationNodeRollbackDelivery(
  input: InstalledOrganizationNodeRollbackDeliveryInput,
  ports: InstalledOrganizationNodeRollbackDeliveryPorts = {},
) {
  return (await runInstalledOrganizationNodeRollbackDelivery(input, "recover", ports)) as Awaited<
    ReturnType<typeof recoverAuthenticatedOrganizationNodeRollbackDelivery>
  >;
}
