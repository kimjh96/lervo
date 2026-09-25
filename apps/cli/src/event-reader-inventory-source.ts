import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { parseNodeRuntimeConfig, type NodeRuntimeConfig } from "@lervo/node-runtime";
import { loadProjectManifest } from "@lervo/project";
import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  listNodeFleetInstances,
  type NodeFleetInstanceRegistration,
} from "@lervo/repository-registry";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import { readNodeServiceCoordinates } from "./node-service-coordinates.js";

const maximumConfigBytes = 1024 * 1024;

export type EventReaderInventorySourceErrorCode =
  | "reader_inventory_fleet_unavailable"
  | "reader_inventory_service_unavailable"
  | "reader_inventory_config_invalid";

export class EventReaderInventorySourceError extends Error {
  constructor(
    readonly code: EventReaderInventorySourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventReaderInventorySourceError";
  }
}

export interface DistributedReaderInventorySource {
  projectId: string;
  repositoryRoot: string;
  repositoryIdentityHash: string;
  registration: NodeFleetInstanceRegistration;
  healthPath: string;
  nodeConfig: NodeRuntimeConfig;
  inventoryHash: string;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fail(code: EventReaderInventorySourceErrorCode, message: string, cause?: unknown): never {
  throw new EventReaderInventorySourceError(code, message, cause === undefined ? {} : { cause });
}

async function readNodeConfig(path: string): Promise<{ config: NodeRuntimeConfig; hash: string }> {
  try {
    const content = await readOwnerOnlyText(path, maximumConfigBytes);
    return {
      config: parseNodeRuntimeConfig(JSON.parse(content), dirname(path)),
      hash: sha256(content),
    };
  } catch (error) {
    fail(
      "reader_inventory_config_invalid",
      "The configured repository Node runtime configuration is unavailable or invalid.",
      error,
    );
  }
}

export interface AbsentRepositoryNodeObservation {
  projectId: string;
  repositoryIdentityHash: string;
  inventoryHash: string;
}

/**
 * Proves that no Node on this host is registered for the repository, by project or by root. Only
 * a Node synchronizes repository events to the Hub, so the local runtime is then the only reader.
 * Null means a registration exists and the fleet authority must be used instead.
 */
export async function observeAbsentRepositoryNode(input: {
  repositoryRoot: string;
  registryPath?: string;
}): Promise<AbsentRepositoryNodeObservation | null> {
  const repositoryRoot = await realpath(resolve(input.repositoryRoot));
  const manifest = await loadProjectManifest(repositoryRoot);
  const repositoryIdentityHash = calculateProjectIdentityHash(manifest);
  let registrations: NodeFleetInstanceRegistration[];
  try {
    registrations = await listNodeFleetInstances(
      input.registryPath ?? defaultNodeFleetRegistryPath(),
    );
  } catch (error) {
    fail(
      "reader_inventory_fleet_unavailable",
      "The owner-only Node fleet registry cannot prove whether this repository has a Node.",
      error,
    );
  }
  if (
    registrations.some(
      (candidate) =>
        candidate.projectId === manifest.projectId || candidate.repositoryRoot === repositoryRoot,
    )
  )
    return null;
  return {
    projectId: manifest.projectId,
    repositoryIdentityHash,
    inventoryHash: sha256(
      canonicalJson({
        schemaVersion: 1,
        kind: "repository_node_absent",
        projectId: manifest.projectId,
        repositoryIdentityHash,
        repositoryRoot,
      }),
    ),
  };
}

export async function resolveDistributedReaderInventorySource(input: {
  repositoryRoot: string;
  registryPath?: string;
  homeDirectory?: string;
}): Promise<DistributedReaderInventorySource> {
  const repositoryRoot = await realpath(resolve(input.repositoryRoot));
  const manifest = await loadProjectManifest(repositoryRoot);
  if (!manifest.dataPolicy.hubSyncEnabled) {
    fail(
      "reader_inventory_fleet_unavailable",
      "Distributed reader inventory is available only when Hub synchronization is enabled.",
    );
  }
  const repositoryIdentityHash = calculateProjectIdentityHash(manifest);
  const registryPath = input.registryPath ?? defaultNodeFleetRegistryPath();
  let registration: NodeFleetInstanceRegistration;
  try {
    const matches = (await listNodeFleetInstances(registryPath)).filter(
      (candidate) =>
        candidate.projectId === manifest.projectId &&
        candidate.repositoryRoot === repositoryRoot &&
        candidate.repositoryIdentityHash === repositoryIdentityHash,
    );
    if (matches.length !== 1) throw new Error("exact repository Node registration missing");
    registration = matches[0]!;
  } catch (error) {
    fail(
      "reader_inventory_fleet_unavailable",
      "The owner-only Node fleet registry does not contain exactly this repository Node.",
      error,
    );
  }
  let serviceDefinitionHash: string;
  let configPath: string;
  try {
    const plan = await createNodeFleetOnboardingPlan({
      registryPath,
      repositoryRoot,
      nodeId: registration.nodeId,
      destinationId: registration.destinationId,
      runtimeVersion: registration.runtimeVersion,
      serviceManager: registration.serviceManager,
      ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
    });
    if (
      plan.registry.reconciliation !== "unchanged" ||
      plan.service.targetState !== "present_unverified" ||
      plan.service.targetContentHash === null
    ) {
      throw new Error("registered service is not exactly observable");
    }
    const service = await readNodeServiceCoordinates({
      manager: registration.serviceManager,
      path: plan.service.targetPath,
      expectedContentHash: plan.service.targetContentHash,
    });
    serviceDefinitionHash = service.contentHash;
    configPath = service.config;
  } catch (error) {
    fail(
      "reader_inventory_service_unavailable",
      "The registered repository Node service definition cannot establish its runtime config.",
      error,
    );
  }
  const nodeConfigObservation = await readNodeConfig(configPath);
  const nodeConfig = nodeConfigObservation.config;
  let configuredRepositoryRoot: string;
  try {
    configuredRepositoryRoot = await realpath(nodeConfig.repositoryRoot);
  } catch (error) {
    fail(
      "reader_inventory_config_invalid",
      "The configured repository Node root cannot be resolved.",
      error,
    );
  }
  if (
    configuredRepositoryRoot !== repositoryRoot ||
    nodeConfig.hub.destinationId !== registration.destinationId
  ) {
    fail(
      "reader_inventory_config_invalid",
      "The registered Node, repository, and Hub destination coordinates do not match.",
    );
  }
  const inventoryHash = sha256(
    canonicalJson({
      schemaVersion: 1,
      projectId: manifest.projectId,
      repositoryIdentityHash,
      registration: {
        serviceInstanceId: registration.serviceInstanceId,
        nodeId: registration.nodeId,
        destinationId: registration.destinationId,
        runtimeVersion: registration.runtimeVersion,
        serviceManager: registration.serviceManager,
        serviceIdentity: registration.serviceIdentity,
      },
      serviceDefinitionHash,
      nodeConfigHash: nodeConfigObservation.hash,
      hub: {
        baseUrl: nodeConfig.hub.baseUrl,
        destinationId: nodeConfig.hub.destinationId,
        identityHash: nodeConfig.hub.hubIdentityHash,
      },
    }),
  );
  return {
    projectId: manifest.projectId,
    repositoryRoot,
    repositoryIdentityHash,
    registration,
    healthPath: registration.healthPath,
    nodeConfig,
    inventoryHash,
  };
}
