import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { appendRepositoryChange, planRepositoryChange } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { startRepositoryKnowledgeLoop } from "../src/repository-knowledge-loop.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const projectId = "prj_0123456789abcdef";

it("settles a queued repository change from the Node loop", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-knowledge-loop-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/state"), { recursive: true });
  await writeFile(resolve(root, "notes.md"), "Implementation note.\n");
  const store = await SQLiteEventStore.open({
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
  } as never;
  const planned = planRepositoryChange({
    sourceKind: "managed_run",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: digest("before"), files: {} },
    after: { revision: digest("after"), files: { "notes.md": digest("Implementation note.\n") } },
    occurredAt: "2026-09-25T09:00:00.000Z",
  })!;
  await (artifacts as { put(content: string): Promise<unknown> }).put(planned.manifestContent);
  store.transact((transaction) =>
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
    ),
  );
  const failures: unknown[] = [];
  const stop = startRepositoryKnowledgeLoop({
    repositoryRoot: root,
    store,
    artifacts,
    provider: "claude",
    host: {
      review: async () => ({ classification: "implementation_only" }),
      inspectKnowledge: async () => ({ current: true, snapshotHash: digest("snapshot") }),
    },
    onFailure: (error) => failures.push(error),
  });
  try {
    await expect
      .poll(
        () =>
          store.list({ limit: 10 }).find((event) => event.type === "repository.knowledge.resolved")
            ?.payload.terminalState,
        { timeout: 5_000 },
      )
      .toBe("current");
    expect(failures).toEqual([]);
  } finally {
    await stop();
    store.close();
  }
});
