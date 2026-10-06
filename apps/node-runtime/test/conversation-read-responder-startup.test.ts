import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { afterEach, describe, expect, it } from "vitest";
import type { RevisionedRepositoryKnowledgeQuery } from "@lervo/repository-context";

import {
  openManagedConversationReadResponder,
  type ManagedConversationRepositoryResources,
} from "../src/conversation-read-responder.js";
import { createNodeRuntimeDeferredWork } from "../src/startup-deferred-work.js";
import {
  nodeRuntimeFixture,
  nodeRuntimeProjectId,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(async () => {
  await removeTemporaryRoots();
});

describe("managed conversation read responder startup", () => {
  it("opens without waiting for a slow knowledge index build and warms it after release", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, 1);
    let snapshots = 0;
    const prepared: string[] = [];
    let finishIndex!: () => void;
    const indexBuilt = new Promise<void>((resolvePromise) => {
      finishIndex = resolvePromise;
    });
    const knowledgeQuery = {
      // A full repository scan and lexical index build that outlasts startup.
      prepare: async (input: { sourceRevision: string }) => {
        prepared.push(input.sourceRevision);
        await indexBuilt;
      },
    } as unknown as RevisionedRepositoryKnowledgeQuery;
    const fallbackTimers: Array<() => void> = [];
    const deferredWork = createNodeRuntimeDeferredWork({
      onFailure: (name, error) => {
        throw new Error(`unexpected deferred failure ${name}`, { cause: error });
      },
      setTimer: (callback) => {
        fallbackTimers.push(callback);
        return { cancel: () => undefined };
      },
    });
    const resources: ManagedConversationRepositoryResources = {
      captureSnapshot: async () => {
        snapshots += 1;
        return { revision: "rev_fixture" } as Awaited<
          ReturnType<ManagedConversationRepositoryResources["captureSnapshot"]>
        >;
      },
      knowledgeQuery,
      deferredWork,
    };

    const opened = await openManagedConversationReadResponder({
      config: {
        integrationId: "itg_discord01",
        applicationId: "999999999999999999",
        botTokenFile: "discord.token",
        intents: 37_377,
        allowedGuildIds: ["123456789012345678"],
        allowDirectMessages: false,
        workerId: "discord-operator",
        agentParticipantId: "ptc_lervoagent",
        conversations: [],
        participants: [],
        routing: { readOnlyRoleId: "conversation-reader", response: { provider: "codex" } },
      } as unknown as Parameters<typeof openManagedConversationReadResponder>[0]["config"],
      projectId: nodeRuntimeProjectId,
      projectCreatedAt: "2026-08-22T00:00:00.000Z",
      agentId: null,
      participationRoleId: "conversation-reader",
      repositoryRoot: fixture.repositoryRoot,
      dataDirectory: resolve(fixture.repositoryRoot, ".lervo/data/conversation/itg_discord01"),
      artifactStore: await FileSystemCas.open(resolve(root, "artifacts")),
      surfaceEffects: [],
      repositoryResources: resources,
    });
    try {
      expect(snapshots).toBe(0);
      expect(prepared).toEqual([]);

      deferredWork.release();
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
      expect(snapshots).toBe(1);
      expect(prepared).toEqual(["rev_fixture"]);
      finishIndex();
    } finally {
      opened.close();
      deferredWork.close();
    }
  });
});
