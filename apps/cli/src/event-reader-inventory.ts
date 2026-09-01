import {
  canonicalJson,
  createEventReaderCapabilities,
  readEventReaderCapabilities,
} from "@lervo/event-contract";
import {
  calculateNodeRuntimeReaderIdentityHash,
  readNodeRuntimeHealthSnapshot,
  type NodeRuntimeHealthSnapshot,
} from "@lervo/node-runtime";
import { loadProjectManifest } from "@lervo/project";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import type { EventWriterActivationEvidence } from "@lervo/schemas";
import {
  HubCapabilityHttpTransport,
  observeVerifiedHubEventReaderCapabilities,
  type AuthenticatedHubCapabilityTransport,
} from "@lervo/sync";

import {
  resolveDistributedReaderInventorySource,
  type DistributedReaderInventorySource,
} from "./event-reader-inventory-source.js";

const maximumHealthBytes = 128 * 1024;
const maximumHealthAgeMs = 2 * 60_000;
const maximumClockLeadMs = 5_000;

export type EventReaderInventoryErrorCode =
  | "reader_inventory_node_health_unavailable"
  | "reader_inventory_node_health_stale"
  | "reader_inventory_node_identity_mismatch"
  | "reader_inventory_hub_unavailable";

export class EventReaderInventoryError extends Error {
  constructor(
    readonly code: EventReaderInventoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventReaderInventoryError";
  }
}

export interface EventReaderInventoryPorts {
  resolveSource(input: {
    repositoryRoot: string;
    registryPath?: string;
    homeDirectory?: string;
  }): Promise<DistributedReaderInventorySource>;
  readHealth(path: string): Promise<unknown>;
  createHubTransport(source: DistributedReaderInventorySource): AuthenticatedHubCapabilityTransport;
  now(): Date;
}

function fail(code: EventReaderInventoryErrorCode, message: string, cause?: unknown): never {
  throw new EventReaderInventoryError(code, message, cause === undefined ? {} : { cause });
}

async function readHealth(path: string): Promise<unknown> {
  return JSON.parse(await readOwnerOnlyText(path, maximumHealthBytes));
}

function createHubTransport(source: DistributedReaderInventorySource) {
  return new HubCapabilityHttpTransport({
    baseUrl: source.nodeConfig.hub.baseUrl,
    expectedHubIdentityHash: source.nodeConfig.hub.hubIdentityHash,
    destinationId: source.nodeConfig.hub.destinationId,
    ...(source.nodeConfig.sync.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: source.nodeConfig.sync.maxResponseBytes }),
    ...(source.nodeConfig.sync.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: source.nodeConfig.sync.requestTimeoutMs }),
  });
}

const defaultPorts: EventReaderInventoryPorts = {
  resolveSource: resolveDistributedReaderInventorySource,
  readHealth,
  createHubTransport,
  now: () => new Date(),
};

function assertCurrentNodeHealth(
  value: unknown,
  source: DistributedReaderInventorySource,
  now: Date,
): NodeRuntimeHealthSnapshot {
  let health: NodeRuntimeHealthSnapshot;
  try {
    health = readNodeRuntimeHealthSnapshot(value);
  } catch (error) {
    fail(
      "reader_inventory_node_health_unavailable",
      "The configured Node reader health snapshot is unavailable or invalid.",
      error,
    );
  }
  const observedAt = Date.parse(health.updatedAt);
  const age = now.getTime() - observedAt;
  if (age < -maximumClockLeadMs || age > maximumHealthAgeMs) {
    fail(
      "reader_inventory_node_health_stale",
      "The configured Node reader health snapshot is not current.",
    );
  }
  const expectedIdentity = {
    projectId: source.projectId,
    repositoryIdentityHash: source.repositoryIdentityHash,
    destinationId: source.registration.destinationId,
  };
  if (
    health.eventReaderIdentity === undefined ||
    canonicalJson(health.eventReaderIdentity) !== canonicalJson(expectedIdentity)
  ) {
    fail(
      "reader_inventory_node_identity_mismatch",
      "The Node reader health identity does not match the authoritative fleet registration.",
    );
  }
  if (health.eventReader === undefined) {
    fail(
      "reader_inventory_node_health_unavailable",
      "The configured Node does not advertise event-reader capabilities.",
    );
  }
  try {
    readEventReaderCapabilities(health.eventReader);
  } catch (error) {
    fail(
      "reader_inventory_node_health_unavailable",
      "The configured Node event-reader capability is invalid.",
      error,
    );
  }
  return health;
}

function readerId(kind: "node" | "hub", identityHash: string): string {
  return `reader_${kind}_${identityHash.slice("sha256:".length, "sha256:".length + 24)}`;
}

export async function collectEventReaderActivationEvidence(input: {
  repositoryRoot: string;
  registryPath?: string;
  ports?: Partial<EventReaderInventoryPorts>;
}): Promise<EventWriterActivationEvidence> {
  const manifest = await loadProjectManifest(input.repositoryRoot);
  const ports = { ...defaultPorts, ...input.ports };
  if (!manifest.dataPolicy.hubSyncEnabled) {
    return {
      schemaVersion: 1,
      projectId: manifest.projectId,
      observedAt: ports.now().toISOString(),
      readers: [
        {
          readerId: "reader_local_runtime",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    };
  }
  const source = await ports.resolveSource({
    repositoryRoot: input.repositoryRoot,
    ...(input.registryPath === undefined ? {} : { registryPath: input.registryPath }),
  });
  const now = ports.now();
  const health = assertCurrentNodeHealth(await ports.readHealth(source.healthPath), source, now);
  let hub;
  try {
    hub = await observeVerifiedHubEventReaderCapabilities({
      transport: ports.createHubTransport(source),
      destinationId: source.nodeConfig.hub.destinationId,
      expectedPeerIdentityHash: source.nodeConfig.hub.hubIdentityHash,
    });
  } catch (error) {
    fail(
      "reader_inventory_hub_unavailable",
      "The configured Hub reader capability could not be observed through its verified identity.",
      error,
    );
  }
  const nodeIdentityHash = calculateNodeRuntimeReaderIdentityHash(health.eventReaderIdentity!);
  const readers = [
    {
      readerId: readerId("hub", hub.peerIdentityHash),
      readerKind: "hub" as const,
      peerIdentityHash: hub.peerIdentityHash,
      capabilities: hub.capabilities,
    },
    {
      readerId: "reader_local_runtime",
      readerKind: "local" as const,
      peerIdentityHash: null,
      capabilities: createEventReaderCapabilities(),
    },
    {
      readerId: readerId("node", nodeIdentityHash),
      readerKind: "node" as const,
      peerIdentityHash: nodeIdentityHash,
      capabilities: health.eventReader!,
    },
  ];
  readers.sort((left, right) =>
    left.readerId < right.readerId ? -1 : left.readerId > right.readerId ? 1 : 0,
  );
  return {
    schemaVersion: 2,
    projectId: source.projectId,
    observedAt: now.toISOString(),
    authority: {
      kind: "repository_node_fleet_v1",
      repositoryIdentityHash: source.repositoryIdentityHash,
      inventoryHash: source.inventoryHash,
    },
    readers,
  };
}
