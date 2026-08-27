import { createPublicKey, verify } from "node:crypto";
import { dirname, resolve } from "node:path";

import {
  applyAuthenticatedOrganizationNodeRolloutDelivery,
  recoverAuthenticatedOrganizationNodeRolloutDelivery,
  type OrganizationNodeRolloutDeliveryTrustStore,
  type OrganizationNodeRolloutDeliveryReplayStore,
  type OrganizationNodeRolloutLocalTransactionPort,
  type TrustedOrganizationNodeRolloutSigner,
} from "@lervo/organization-deployment-contract";
import { SQLiteOrganizationNodeRolloutReplayStore } from "@lervo/organization-deployment-sqlite";
import { loadProjectManifest } from "@lervo/project";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import { type SignedOrganizationNodeRolloutDelivery, validateSchema } from "@lervo/schemas";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import {
  createInstalledOrganizationNodeRolloutPort,
  type InstalledOrganizationNodeRolloutBinding,
} from "./organization-node-rollout.js";

const MAXIMUM_DELIVERY_BYTES = 1_048_576;
const MAXIMUM_TRUST_BYTES = 262_144;
const MAXIMUM_PUBLIC_KEY_BYTES = 65_536;

interface RolloutTrustKeySource {
  keyId: string;
  publicKeyFile: string;
  organizationIds: string[];
  projects: Array<{ projectId: string; projectIdentityHash: string }>;
  principalId?: string;
}

export interface InstalledOrganizationNodeRolloutDeliveryInput {
  requestPath: string;
  trustPath: string;
  replayPath: string;
  binding: InstalledOrganizationNodeRolloutBinding;
}

export interface InstalledOrganizationNodeRolloutDeliveryPorts {
  createLocalPort?: (
    binding: InstalledOrganizationNodeRolloutBinding,
  ) => OrganizationNodeRolloutLocalTransactionPort;
  openReplayStore?: (input: {
    path: string;
    target: { projectId: string; projectIdentityHash: string };
    nodeId: string;
    destinationId: string;
  }) => Promise<OrganizationNodeRolloutDeliveryReplayStore & { close(): void }>;
  loadManifest?: typeof loadProjectManifest;
  now?: () => Date;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(`${label} contains unexpected fields.`);
  }
}

function stringArray(value: unknown, pattern: RegExp, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 256 ||
    new Set(value).size !== value.length ||
    !value.every((entry) => typeof entry === "string" && pattern.test(entry))
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return [...value] as string[];
}

function trustKey(value: unknown, purpose: "policy" | "approval"): RolloutTrustKeySource {
  const source = record(value, `${purpose} trust key`);
  exactKeys(
    source,
    purpose === "approval"
      ? ["keyId", "principalId", "publicKeyFile", "organizationIds", "projects"]
      : ["keyId", "publicKeyFile", "organizationIds", "projects"],
    `${purpose} trust key`,
  );
  if (
    typeof source.keyId !== "string" ||
    !/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(source.keyId) ||
    typeof source.publicKeyFile !== "string" ||
    source.publicKeyFile.length < 1 ||
    /[\0\r\n]/u.test(source.publicKeyFile) ||
    (purpose === "approval" &&
      (typeof source.principalId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(source.principalId)))
  ) {
    throw new Error(`The ${purpose} trust key identity is invalid.`);
  }
  if (!Array.isArray(source.projects)) {
    throw new Error("The organization rollout trust project scope is invalid.");
  }
  const projects = source.projects.map((entry) => {
    const project = record(entry, "trusted project");
    exactKeys(project, ["projectId", "projectIdentityHash"], "trusted project");
    if (
      typeof project.projectId !== "string" ||
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(project.projectId) ||
      typeof project.projectIdentityHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(project.projectIdentityHash)
    ) {
      throw new Error("A trusted organization rollout project is invalid.");
    }
    return {
      projectId: project.projectId,
      projectIdentityHash: project.projectIdentityHash,
    };
  });
  if (projects.length < 1 || projects.length > 256) {
    throw new Error("The organization rollout trust project scope is invalid.");
  }
  return {
    keyId: source.keyId,
    publicKeyFile: source.publicKeyFile,
    organizationIds: stringArray(
      source.organizationIds,
      /^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
      "organizationIds",
    ),
    projects,
    ...(purpose === "approval" ? { principalId: source.principalId as string } : {}),
  };
}

export async function loadOrganizationNodeRolloutTrustStore(
  path: string,
): Promise<OrganizationNodeRolloutDeliveryTrustStore> {
  const serialized = await readOwnerOnlyText(resolve(path), MAXIMUM_TRUST_BYTES);
  const source = record(JSON.parse(serialized) as unknown, "organization rollout trust");
  exactKeys(source, ["schemaVersion", "policyKeys", "approvalKeys"], "organization rollout trust");
  if (
    source.schemaVersion !== 1 ||
    !Array.isArray(source.policyKeys) ||
    !Array.isArray(source.approvalKeys)
  ) {
    throw new Error("The organization rollout trust schema is invalid.");
  }
  const directory = dirname(resolve(path));
  const sources = [
    ...source.policyKeys.map((entry) => ({
      purpose: "policy" as const,
      source: trustKey(entry, "policy"),
    })),
    ...source.approvalKeys.map((entry) => ({
      purpose: "approval" as const,
      source: trustKey(entry, "approval"),
    })),
  ];
  if (
    sources.length < 2 ||
    sources.length > 512 ||
    new Set(sources.map((entry) => `${entry.purpose}\0${entry.source.keyId}`)).size !==
      sources.length
  ) {
    throw new Error("The organization rollout trust key set is empty, duplicated, or too large.");
  }
  const signers = await Promise.all(
    sources.map(async ({ purpose, source }): Promise<TrustedOrganizationNodeRolloutSigner> => {
      const publicKey = createPublicKey(
        await readOwnerOnlyText(resolve(directory, source.publicKeyFile), MAXIMUM_PUBLIC_KEY_BYTES),
      );
      if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("An organization rollout trust key is not Ed25519.");
      }
      const common = {
        keyId: source.keyId,
        organizationIds: source.organizationIds,
        projects: source.projects,
        verify: async (input: { message: Uint8Array; signature: Uint8Array }) =>
          verify(null, input.message, publicKey, input.signature),
      };
      if (purpose === "approval") {
        return { ...common, purpose: "approval", principalId: source.principalId! };
      }
      return { ...common, purpose: "policy" };
    }),
  );
  return {
    async find(input) {
      const signer = signers.find(
        (candidate) => candidate.purpose === input.purpose && candidate.keyId === input.keyId,
      );
      return signer ?? null;
    },
  };
}

async function loadDelivery(path: string): Promise<SignedOrganizationNodeRolloutDelivery> {
  const value = JSON.parse(
    await readOwnerOnlyText(resolve(path), MAXIMUM_DELIVERY_BYTES),
  ) as unknown;
  if (!validateSchema("signedOrganizationNodeRolloutDelivery", value).valid) {
    throw new Error("The signed organization rollout delivery file is invalid.");
  }
  return structuredClone(value as SignedOrganizationNodeRolloutDelivery);
}

async function runInstalledOrganizationNodeRolloutDelivery(
  input: InstalledOrganizationNodeRolloutDeliveryInput,
  mode: "execute" | "recover",
  ports: InstalledOrganizationNodeRolloutDeliveryPorts = {},
) {
  const [envelope, trustStore, manifest] = await Promise.all([
    loadDelivery(input.requestPath),
    loadOrganizationNodeRolloutTrustStore(input.trustPath),
    (ports.loadManifest ?? loadProjectManifest)(input.binding.repositoryRoot),
  ]);
  const target = {
    projectId: manifest.projectId,
    projectIdentityHash: calculateProjectIdentityHash(manifest),
  };
  const openReplay = ports.openReplayStore ?? SQLiteOrganizationNodeRolloutReplayStore.open;
  const replayStore = await openReplay({
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
      local: (ports.createLocalPort ?? createInstalledOrganizationNodeRolloutPort)(input.binding),
      now: (ports.now ?? (() => new Date()))().toISOString(),
    };
    return mode === "execute"
      ? await applyAuthenticatedOrganizationNodeRolloutDelivery(request)
      : await recoverAuthenticatedOrganizationNodeRolloutDelivery(request);
  } finally {
    replayStore.close();
  }
}

export async function executeInstalledOrganizationNodeRolloutDelivery(
  input: InstalledOrganizationNodeRolloutDeliveryInput,
  ports: InstalledOrganizationNodeRolloutDeliveryPorts = {},
) {
  return (await runInstalledOrganizationNodeRolloutDelivery(input, "execute", ports)) as Awaited<
    ReturnType<typeof applyAuthenticatedOrganizationNodeRolloutDelivery>
  >;
}

export async function recoverInstalledOrganizationNodeRolloutDelivery(
  input: InstalledOrganizationNodeRolloutDeliveryInput,
  ports: InstalledOrganizationNodeRolloutDeliveryPorts = {},
) {
  return (await runInstalledOrganizationNodeRolloutDelivery(input, "recover", ports)) as Awaited<
    ReturnType<typeof recoverAuthenticatedOrganizationNodeRolloutDelivery>
  >;
}
