import { afterEach, expect, it } from "vitest";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  MemoryArtifactStore,
  providerRunInput,
  projectId,
  runId,
} from "./fixture.js";
import { coordinator } from "./managed-provider-run-test-harness.js";
import { FakeManagedAdapter } from "./provider-run-fake-adapter.js";

afterEach(cleanupManagedFixtures);

it.each(["codex", "claude"] as const)(
  "binds exact inputs before %s startup without exposing their text in events",
  async (provider) => {
    const f = await createManagedFixture();
    const path = f.store.path;
    f.store.close();
    const store = await SQLiteEventStore.open({ path, projectId, writableEventSchemaVersion: 3 });
    try {
      const artifacts = new MemoryArtifactStore();
      const source = await artifacts.put(
        Buffer.from(JSON.stringify({ question: "private bounded input" })),
      );
      const adapter = new FakeManagedAdapter(provider);
      await coordinator(adapter, f.root, store, undefined, artifacts).run({
        ...providerRunInput(),
        repositoryRoot: f.root,
        roleInput: {
          contractId: "fixture.inputs.v1",
          roleContractHash: `sha256:${"b".repeat(64)}`,
          inputArtifactHash: source.contentHash,
        },
      });
      const events = store.list({ runId });
      const bound = events.find((event) => event.type === "role.input.bound")!;
      expect(bound.payload).toMatchObject({
        inputArtifactHash: source.contentHash,
        inputByteCount: source.byteCount,
      });
      expect(bound.seq).toBeLessThan(events.find((event) => event.type === "adapter.started")!.seq);
      expect(JSON.stringify(events)).not.toContain("private bounded input");
    } finally {
      store.close();
    }
  },
);

it.each(["missing", "corrupt", "old_writer"] as const)(
  "rejects %s role input evidence before provider startup",
  async (scenario) => {
    const f = await createManagedFixture();
    const artifacts = new MemoryArtifactStore();
    const source = await artifacts.put(Buffer.from(JSON.stringify({ question: "original" })));
    if (scenario === "missing") artifacts.objects.delete(source.uri);
    if (scenario === "corrupt") artifacts.objects.set(source.uri, Buffer.from("{}"));
    const adapter = new FakeManagedAdapter("codex");
    try {
      await expect(
        coordinator(adapter, f.root, f.store, undefined, artifacts).run({
          ...providerRunInput(),
          repositoryRoot: f.root,
          roleInput: {
            contractId: "fixture.inputs.v1",
            roleContractHash: `sha256:${"b".repeat(64)}`,
            inputArtifactHash: source.contentHash,
          },
        }),
      ).rejects.toThrow();
      expect(adapter.calls).toEqual([]);
      expect(f.store.list({ runId }).some((event) => event.type === "run.completed")).toBe(false);
    } finally {
      f.store.close();
    }
  },
);
