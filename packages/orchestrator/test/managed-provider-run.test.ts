import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProviderAdapter } from "@roven/adapter-contract";
import { FileSystemCas } from "@roven/cas";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedProviderRunCoordinator,
  ManagedProviderRunError,
  type ManagedEventStore,
} from "../src/index.js";
import {
  failOnEventType,
  cleanupManagedFixtures,
  createManagedFixture,
  MemoryArtifactStore,
  policyVersion,
  providerRunInput,
  projectId,
  role,
  runId,
  sequenceFactory,
  sessionId,
  targetDigest,
} from "./fixture.js";
import { FakeManagedAdapter } from "./provider-run-fake-adapter.js";

function clock() {
  let value = Date.parse("2026-08-18T01:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

afterEach(async () => {
  await cleanupManagedFixtures();
});
function coordinator(
  adapter: ProviderAdapter,
  root: string,
  events: ManagedEventStore,
  deadlines?: ConstructorParameters<typeof ManagedProviderRunCoordinator>[0]["deadlines"],
  artifactStore: ConstructorParameters<
    typeof ManagedProviderRunCoordinator
  >[0]["artifactStore"] = new MemoryArtifactStore(),
) {
  return new ManagedProviderRunCoordinator({
    adapter,
    coordinates: { projectId, runId, sessionId, roleId: role.roleId },
    policyVersion,
    events,
    artifactStore,
    ...(deadlines === undefined ? {} : { deadlines }),
    now: clock(),
    createEventId: sequenceFactory("evt_managedrun"),
  });
}

describe("managed provider run coordinator", () => {
  it.each(["codex", "claude"] as const)(
    "runs the %s lifecycle only after controlled context injection",
    async (provider) => {
      const data = await createManagedFixture();
      const adapter = new FakeManagedAdapter(provider);
      const artifactStore = new MemoryArtifactStore();
      const result = await coordinator(
        adapter,
        data.root,
        data.store,
        undefined,
        artifactStore,
      ).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      });

      expect(result).toMatchObject({
        status: "completed",
        contextGeneration: 0,
        beforeRevision: result.afterRevision,
      });
      expect(result.session.executionMode).toBe("read_only");
      expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8"))
        .toBe("fixture provider result");
      expect(adapter.calls).toEqual([
        "start",
        "injectContext",
        "attachManagedWriteBridge",
        "startTurn",
        "getTurnResult",
        "stop",
      ]);
      expect(adapter.stopReason).toBe("completed");
      expect(data.store.list({ runId }).map((event) => event.type)).toEqual([
        "run.requested",
        "run.resolved",
        "adapter.started",
        "context.selected",
        "context.selected",
        "document.loaded",
        "context.injected",
        "tool.called",
        "command.executed",
        "adapter.stopped",
        "run.completed",
      ]);
      const serialized = JSON.stringify(data.store.list({ runId }));
      expect(serialized).not.toContain("저장소를 읽고 결과를 설명합니다");
      expect(serialized).not.toContain("fixture provider result");
      expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
        resultDigest: result.resultArtifact.contentHash,
        artifactIds: [result.resultArtifact.artifactId],
      });
      expect(data.store.verifyIntegrity().valid).toBe(true);
      data.store.close();
    },
  );

  it("fails a write-capable run that produces no verified change", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();
    const run = coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, role },
    });

    await expect(run).rejects.toMatchObject({ code: "provider_write_failed" });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("run.completed");
    data.store.close();
  });

  it("still fails when a verified change is accompanied by another filesystem mutation", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", {
      managedWrite: {
        path: "src/result.ts",
        targetDigest,
        changeKind: "created",
        apply: async () => {
          await writeFile(resolve(data.root, "src/result.ts"), "managed\n");
          await writeFile(resolve(data.root, "src/unmanaged.ts"), "unmanaged\n");
        },
      },
    });
    const input = providerRunInput();
    const run = coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, role },
    });

    await expect(run).rejects.toMatchObject({
      code: "unmanaged_change_detected",
      paths: ["src/unmanaged.ts"],
    });
    expect(
      data.store.list({ runId }).find((event) => event.type === "unmanaged_change.detected")?.payload,
    ).toMatchObject({ paths: ["src/unmanaged.ts"] });
    data.store.close();
  });

  it("fails when the provider reports a different change kind than the actual file state", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", {
      managedWrite: {
        path: "src/result.ts",
        targetDigest,
        changeKind: "modified",
        apply: () => writeFile(resolve(data.root, "src/result.ts"), "created instead\n"),
      },
    });
    const input = providerRunInput();
    const run = coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, role },
    });

    await expect(run).rejects.toMatchObject({
      code: "unmanaged_change_detected",
      paths: ["src/result.ts"],
      relatedFailures: expect.arrayContaining([
        expect.objectContaining({ code: "provider_write_failed" }),
      ]),
    });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("file.changed");
    data.store.close();
  });

  it("invalidates E3 on provider compaction without pretending the turn failed", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { compact: true });
    const result = await coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });
    expect(result.contextGeneration).toBe(1);
    expect(data.store.list({ runId }).map((event) => event.type)).toContain("context.invalidated");
    expect(
      data.store.list({ runId }).find((event) => event.type === "context.invalidated")?.payload,
    ).toMatchObject({ reason: "context_compacted", contextGeneration: 0 });
    data.store.close();
  });

  it("stores the provider result in the real filesystem CAS", async () => {
    const data = await createManagedFixture();
    const artifacts = await FileSystemCas.open(resolve(data.root, ".roven/state/cas"));
    const result = await coordinator(
      new FakeManagedAdapter("codex"),
      data.root,
      data.store,
      undefined,
      artifacts,
    ).run({ ...providerRunInput(), repositoryRoot: data.root });

    expect(Buffer.from(await artifacts.get(result.resultArtifact.uri)).toString("utf8"))
      .toBe("fixture provider result");
    expect(result.beforeRevision).toBe(result.afterRevision);
    data.store.close();
  });

  it("records a persistent provider-side change as unmanaged and fails the run", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", {
      mutate: () => writeFile(resolve(data.root, "src/result.ts"), "unmanaged bytes\n"),
    });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });
    await expect(run).rejects.toEqual(
      expect.objectContaining<Partial<ManagedProviderRunError>>({
        code: "unmanaged_change_detected",
        paths: ["src/result.ts"],
      }),
    );
    expect(data.store.list({ runId }).map((event) => event.type)).toEqual(
      expect.arrayContaining(["unmanaged_change.detected", "run.failed"]),
    );
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("file.changed");
    expect(data.store.list({ runId }).at(-2)?.payload).toMatchObject({
      paths: ["src/result.ts"],
    });
    data.store.close();
  });

  it("interrupts and stops the provider when the caller cancels the run", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { hang: true });
    const controller = new AbortController();
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
      signal: controller.signal,
    });
    await adapter.turnAccepted;
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(adapter.stopReason).toBe("cancelled");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "cancelled",
      retryable: false,
    });
    data.store.close();
  });

  it("fails before provider startup when the initial telemetry transaction cannot commit", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const events: ManagedEventStore = {
      transact: () => {
        throw new Error("fixture storage failure");
      },
    };
    const run = new ManagedProviderRunCoordinator({
      adapter,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events,
      artifactStore: new MemoryArtifactStore(),
      now: clock(),
      createEventId: sequenceFactory("evt_managedrun"),
    }).run({ ...providerRunInput(), repositoryRoot: data.root });

    await expect(run).rejects.toMatchObject({ code: "telemetry_recording_failed" });
    expect(adapter.calls).toEqual([]);
    data.store.close();
  });

  it.each(["codex", "claude"] as const)(
    "records one %s provider write only after permit and byte verification",
    async (provider) => {
      const data = await createManagedFixture();
      const output = "export const managed = true;\n";
      const adapter = new FakeManagedAdapter(provider, {
        managedWrite: {
          path: "src/result.ts",
          targetDigest,
          changeKind: "created",
          apply: () => writeFile(resolve(data.root, "src/result.ts"), output),
        },
      });
      const input = providerRunInput();
      const result = await coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        context: { ...input.context, role },
      });

      expect(result.session.executionMode).toBe("managed_write");
      expect(result.contextGeneration).toBe(1);
      expect(result.beforeRevision).not.toBe(result.afterRevision);
      expect(result.managedChanges).toEqual([
        expect.objectContaining({
          path: "src/result.ts",
          beforeHash: null,
          changeKind: "created",
        }),
      ]);
      const events = data.store.list({ runId });
      expect(events.map((event) => event.type)).toContain("file.changed");
      expect(events.map((event) => event.type)).not.toContain("unmanaged_change.detected");
      expect(JSON.stringify(events)).not.toContain(output.trim());
      data.store.close();
    },
  );

  it("rejects a terminal signal that belongs to another provider turn", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", { terminalTurnId: "foreign-turn" });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "contract_validation_failed",
    });
    data.store.close();
  });

  it("classifies an adapter event stream failure separately from a failed turn", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", { streamFailure: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "provider_stream_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "provider_stream_failed",
      retryable: true,
    });
    data.store.close();
  });

  it("does not ignore an invalid provider signal that follows the terminal event", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { postTerminalMismatch: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.stopReason).toBe("failed");
    data.store.close();
  });

  it("keeps telemetry failure distinct from provider stop failure", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const run = coordinator(
      adapter,
      data.root,
      failOnEventType(data.store, "adapter.stopped"),
    ).run({ ...providerRunInput(), repositoryRoot: data.root });

    await expect(run).rejects.toMatchObject({ code: "telemetry_recording_failed" });
    expect(adapter.calls.at(-1)).toBe("stop");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "telemetry_recording_failed",
    });
    data.store.close();
  });

  it("retains stop failure as primary while also reporting unmanaged changes", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", {
      failStop: true,
      mutate: () => writeFile(resolve(data.root, "src/result.ts"), "unmanaged bytes\n"),
    });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({
      code: "provider_stop_failed",
      paths: ["src/result.ts"],
      relatedFailures: expect.arrayContaining([
        expect.objectContaining({ code: "provider_stop_failed" }),
        expect.objectContaining({ code: "unmanaged_change_detected" }),
      ]),
    });
    expect(data.store.list({ runId }).map((event) => event.type)).toContain(
      "unmanaged_change.detected",
    );
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "provider_stop_failed",
    });
    data.store.close();
  });

  it("bounds a provider that does not finish stopping", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { hangOnStop: true });
    const run = coordinator(adapter, data.root, data.store, { adapterStopMs: 10 }).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "provider_stop_failed" });
    data.store.close();
  });

  it("bounds a provider turn that never reaches a terminal signal", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { hang: true });
    const run = coordinator(adapter, data.root, data.store, { providerTurnMs: 10 }).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "provider_turn_failed" });
    expect(adapter.stopReason).toBe("failed");
    data.store.close();
  });

  it("fails when a completed provider turn has no retrievable result", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { failResult: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "provider_result_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("run.completed");
    data.store.close();
  });

  it("fails when stored result bytes cannot be read back unchanged", async () => {
    class CorruptingArtifactStore extends MemoryArtifactStore {
      override async get(uri: string): Promise<Uint8Array> {
        await super.get(uri);
        return Buffer.from("corrupted result", "utf8");
      }
    }
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const run = coordinator(
      adapter,
      data.root,
      data.store,
      undefined,
      new CorruptingArtifactStore(),
    ).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "artifact_storage_failed" });
    expect(adapter.stopReason).toBe("completed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "artifact_storage_failed",
      retryable: true,
    });
    data.store.close();
  });

  it("does not record adapter.stopped for a mismatched stop result", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", { invalidStopCoordinates: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("adapter.stopped");
    data.store.close();
  });
});
