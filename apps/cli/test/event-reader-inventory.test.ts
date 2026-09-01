import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createEventReaderCapabilities } from "@lervo/event-contract";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { collectEventReaderActivationEvidence } from "../src/event-reader-inventory.js";
import type { DistributedReaderInventorySource } from "../src/event-reader-inventory-source.js";

const roots: string[] = [];
const observedAt = "2026-09-01T09:00:00.000Z";
const repositoryIdentityHash = `sha256:${"a".repeat(64)}`;
const hubIdentityHash = `sha256:${"b".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reader-inventory-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_inventory01",
      now: new Date("2026-09-01T08:00:00.000Z"),
    }),
  );
  const manifestPath = resolve(root, ".lervo/project.yaml");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, manifest.replace("hubSyncEnabled: false", "hubSyncEnabled: true"));
  return root;
}

function source(root: string): DistributedReaderInventorySource {
  return {
    projectId: "prj_inventory01",
    repositoryRoot: root,
    repositoryIdentityHash,
    registration: {
      serviceInstanceId: "nfi_1234567890abcdef12345678",
      projectId: "prj_inventory01",
      repositoryIdentityHash,
      repositoryRoot: root,
      nodeId: "node_inventory01",
      destinationId: "hub:inventory",
      runtimeVersion: "0.8.2",
      serviceManager: "launchd",
      serviceIdentity: "com.lervo.node.1234567890abcdef12345678",
      healthPath: resolve(root, ".lervo/state/node-runtime-health.json"),
      registeredAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
    healthPath: resolve(root, ".lervo/state/node-runtime-health.json"),
    nodeConfig: {
      schemaVersion: 1,
      repositoryRoot: root,
      hub: {
        baseUrl: "https://hub.example.test/",
        bearerTokenFile: resolve(root, "hub.token"),
        destinationId: "hub:inventory",
        hubIdentityHash,
      },
      sync: { workerId: "node:inventory" },
    },
    inventoryHash: `sha256:${"c".repeat(64)}`,
  };
}

function health(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: "ready",
    processId: 1234,
    startedAt: "2026-09-01T08:59:00.000Z",
    updatedAt: observedAt,
    eventReader: createEventReaderCapabilities(),
    eventReaderIdentity: {
      projectId: "prj_inventory01",
      repositoryIdentityHash,
      destinationId: "hub:inventory",
    },
    sync: { status: "ready" },
    workstreamReplication: { status: "ready" },
    workspaceCoordination: { status: "disabled" },
    remoteControl: { status: "disabled" },
    ...overrides,
  };
}

function ports(root: string, healthValue: unknown = health()) {
  return {
    resolveSource: async () => source(root),
    readHealth: async () => healthValue,
    createHubTransport: () => ({
      readEventReaderCapabilities: async () => ({
        authentication: {
          status: "verified",
          destinationId: "hub:inventory",
          peerIdentityHash: hubIdentityHash,
        },
        body: createEventReaderCapabilities(),
      }),
    }),
    now: () => new Date(observedAt),
  };
}

describe("distributed event reader inventory", () => {
  it("composes exact local, registered Node, and verified Hub evidence", async () => {
    const root = await repository();

    await expect(
      collectEventReaderActivationEvidence({ repositoryRoot: root, ports: ports(root) }),
    ).resolves.toMatchObject({
      schemaVersion: 2,
      authority: {
        kind: "repository_node_fleet_v1",
        repositoryIdentityHash,
        inventoryHash: `sha256:${"c".repeat(64)}`,
      },
      readers: [
        { readerKind: "hub", peerIdentityHash: hubIdentityHash },
        { readerKind: "local", peerIdentityHash: null },
        { readerKind: "node", peerIdentityHash: expect.stringMatching(/^sha256:/) },
      ],
    });
  });

  it("fails closed on stale or identity-mismatched Node capability evidence", async () => {
    const root = await repository();
    await expect(
      collectEventReaderActivationEvidence({
        repositoryRoot: root,
        ports: ports(root, health({ updatedAt: "2026-09-01T08:00:00.000Z" })),
      }),
    ).rejects.toMatchObject({ code: "reader_inventory_node_health_stale" });
    await expect(
      collectEventReaderActivationEvidence({
        repositoryRoot: root,
        ports: ports(
          root,
          health({
            eventReaderIdentity: {
              projectId: "prj_inventory01",
              repositoryIdentityHash,
              destinationId: "hub:other",
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "reader_inventory_node_identity_mismatch" });
  });

  it("fails closed when the Hub response does not prove the configured identity", async () => {
    const root = await repository();
    const currentPorts = ports(root);
    await expect(
      collectEventReaderActivationEvidence({
        repositoryRoot: root,
        ports: {
          ...currentPorts,
          createHubTransport: () => ({
            readEventReaderCapabilities: async () => ({
              authentication: {
                status: "unverified",
                destinationId: "hub:inventory",
                peerIdentityHash: null,
              },
              body: null,
            }),
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "reader_inventory_hub_unavailable" });
  });
});
