import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore, type EventDraft } from "@lervo/event-store-sqlite";
import {
  createEventWriterActivationId,
  eventWriterActivationConfigurationHash,
  serializeYaml,
} from "@lervo/project";
import type { EventWriterActivationEvidence } from "@lervo/schemas";

const roots: string[] = [];

export const nodeRuntimeDestinationId = "hub:node-runtime-test";
export const nodeRuntimeProjectId = "prj_node_runtime_01";
export const nodeRuntimeHubIdentityHash = `sha256:${"9".repeat(64)}`;
export const nodeRuntimeToken = "node-runtime-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";

export async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-runtime-"));
  roots.push(root);
  return root;
}

export async function removeTemporaryRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test port unavailable");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

export async function ownerFile(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

function eventDraft(): EventDraft {
  return {
    eventId: "evt_node_runtime_01",
    projectId: nodeRuntimeProjectId,
    runId: "run_node_runtime_01",
    sessionId: "ses_node_runtime_01",
    type: "run.requested",
    occurredAt: "2026-08-22T00:00:01.000Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: {
      requestDigest: `sha256:${"1".repeat(64)}`,
      role: "developer",
      risk: "low",
    },
  };
}

export async function nodeRuntimeFixture(
  root: string,
  hubPort: number,
  options: { hubSyncEnabled?: boolean } = {},
): Promise<{
  configPath: string;
  databasePath: string;
  repositoryRoot: string;
  value: Record<string, unknown>;
}> {
  const repositoryRoot = resolve(root, "repository");
  const data = resolve(repositoryRoot, ".lervo/data");
  await mkdir(data, { recursive: true });
  await writeFile(
    resolve(repositoryRoot, ".lervo/project.yaml"),
    serializeYaml({
      schemaVersion: 1,
      projectId: nodeRuntimeProjectId,
      name: "node-runtime-test",
      root: ".",
      createdAt: "2026-08-22T00:00:00.000Z",
      dataPolicy: {
        eventMetadataRetentionDays: 90,
        artifactRetentionDays: 30,
        persistRawPrompts: false,
        persistDocumentBodiesInEvents: false,
        hubSyncEnabled: options.hubSyncEnabled ?? true,
        eventPayloadMode: "allowlist",
      },
    }),
  );
  const observedAt = "2026-08-22T00:00:00.000Z";
  const capabilities = {
    schemaVersion: 1 as const,
    capability: "event_reader" as const,
    readableEventSchemaVersions: [1, 2],
  };
  const evidence: EventWriterActivationEvidence = {
    schemaVersion: 2,
    projectId: nodeRuntimeProjectId,
    observedAt,
    authority: {
      kind: "repository_node_fleet_v1",
      repositoryIdentityHash: `sha256:${"7".repeat(64)}`,
      inventoryHash: `sha256:${"8".repeat(64)}`,
    },
    readers: [
      {
        readerId: "reader_hub_runtime",
        readerKind: "hub",
        peerIdentityHash: nodeRuntimeHubIdentityHash,
        capabilities,
      },
      {
        readerId: "reader_local_runtime",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities,
      },
      {
        readerId: "reader_node_runtime",
        readerKind: "node",
        peerIdentityHash: `sha256:${"6".repeat(64)}`,
        capabilities,
      },
    ],
  };
  const configurationHash = eventWriterActivationConfigurationHash({
    evidence,
    hubSyncEnabled: options.hubSyncEnabled ?? true,
  });
  await writeFile(
    resolve(data, "event-contract.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: nodeRuntimeProjectId,
        selectedEventSchemaVersion: 2,
        activationEvidence: {
          activationId: createEventWriterActivationId({
            projectId: nodeRuntimeProjectId,
            observedAt,
            configurationHash,
            readers: evidence.readers,
          }),
          observedAt,
          configurationHash,
          readers: evidence.readers,
        },
      },
      null,
      2,
    )}\n`,
  );
  const databasePath = resolve(data, "events.sqlite");
  const events = await SQLiteEventStore.open({
    path: databasePath,
    projectId: nodeRuntimeProjectId,
  });
  events.transact((transaction) => {
    const event = transaction.append(eventDraft()).event;
    transaction.enqueue({
      eventId: event.eventId,
      destinationId: nodeRuntimeDestinationId,
      enqueuedAt: "2026-08-22T00:01:00.000Z",
    });
  });
  events.close();
  const tokenPath = resolve(root, "hub.token");
  await ownerFile(tokenPath, `${nodeRuntimeToken}\n`);
  const value = {
    schemaVersion: 1,
    repositoryRoot: "repository",
    hub: {
      baseUrl: `https://127.0.0.1:${hubPort}/`,
      bearerTokenFile: "hub.token",
      destinationId: nodeRuntimeDestinationId,
      hubIdentityHash: nodeRuntimeHubIdentityHash,
    },
    sync: {
      workerId: "node:runtime-test",
      idlePollIntervalMs: 100,
      retryDelayMs: 100,
    },
  };
  const configPath = resolve(root, "node-runtime.json");
  await ownerFile(configPath, JSON.stringify(value));
  return { configPath, databasePath, repositoryRoot, value };
}
