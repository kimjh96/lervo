import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  appendRepositoryChange,
  planRepositoryChange,
  type RepositoryKnowledgeWorkerHost,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { runKnowledgeWorker } from "../src/knowledge-worker-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const projectId = "prj_0123456789abcdef";

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-worker-cli-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/state"), { recursive: true });
  await writeFile(resolve(root, "notes.md"), "Implementation note.\n");
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  const cas = new Map<string, Uint8Array>();
  const artifacts = {
    has: async (uri: string) => cas.has(uri),
    get: async (uri: string) => cas.get(uri)!,
    put: async (content: string) => {
      const contentHash = digest(content);
      cas.set(`lervo-cas://sha256/${contentHash.slice(7)}`, Buffer.from(content));
      return { contentHash };
    },
  };
  const planned = planRepositoryChange({
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: digest("before"), files: {} },
    after: { revision: digest("after"), files: { "notes.md": digest("Implementation note.\n") } },
    occurredAt: "2026-09-25T09:00:00.000Z",
  })!;
  await artifacts.put(planned.manifestContent);
  events.transact((transaction) =>
    appendRepositoryChange(
      transaction,
      {
        eventId: "evt_0123456789abcdef0123456789abcdef",
        projectId,
        runId: "run_0123456789abcdef0123456789abcdef",
        sessionId: "ses_0123456789abcdef0123456789abcdef",
        occurredAt: "2026-09-25T09:00:00.000Z",
        actor: { kind: "system" },
        policyVersion: digest("policy"),
      },
      planned,
      { admitted: true },
    ),
  );
  const storage = {
    paths: { repositoryRoot: root },
    events,
    artifacts,
    close: async () => undefined,
  } as unknown as ProjectStorage;
  return { root, events, openStorage: async () => storage };
}

const host: RepositoryKnowledgeWorkerHost = {
  review: async () => ({ classification: "implementation_only" }),
  inspectKnowledge: async () => ({ current: true, snapshotHash: digest("snapshot") }),
};

it("settles queued jobs under the repository lock and releases it", async () => {
  const repo = await repository();
  try {
    expect(
      await runKnowledgeWorker({
        root: repo.root,
        provider: "claude",
        openStorage: repo.openStorage as never,
        host,
      }),
    ).toEqual({
      status: "processed",
      outcomes: [
        {
          changeEventId: "evt_0123456789abcdef0123456789abcdef",
          terminalState: "current",
          failureCode: null,
        },
      ],
    });
    await expect(
      readFile(resolve(repo.root, ".lervo/state/knowledge-worker.lock")),
    ).rejects.toThrow();
  } finally {
    repo.events.close();
  }
});

it("yields to a live worker and reclaims a lock left by an exited one", async () => {
  const repo = await repository();
  const lock = resolve(repo.root, ".lervo/state/knowledge-worker.lock");
  try {
    await writeFile(lock, `${process.pid}\n`);
    expect(
      await runKnowledgeWorker({
        root: repo.root,
        provider: "codex",
        openStorage: repo.openStorage as never,
        host,
      }),
    ).toEqual({ status: "busy" });
    await writeFile(lock, "2147483646\n");
    expect(
      await runKnowledgeWorker({
        root: repo.root,
        provider: "codex",
        openStorage: repo.openStorage as never,
        host,
      }),
    ).toMatchObject({ status: "processed" });
  } finally {
    repo.events.close();
  }
});
