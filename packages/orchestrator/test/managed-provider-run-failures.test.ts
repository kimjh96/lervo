import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupManagedFixtures,
  createManagedFixture,
  failOnEventType,
  MemoryArtifactStore,
  providerRunInput,
  runId,
} from "./fixture.js";
import { coordinator } from "./managed-provider-run-test-harness.js";
import { FakeManagedAdapter } from "./provider-run-fake-adapter.js";

afterEach(cleanupManagedFixtures);

describe("managed provider failure boundaries", () => {
  it("preserves capability activation failures raised while starting a provider", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", { failActivationAtStart: true });
    const run = coordinator(adapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });

    await expect(run).rejects.toMatchObject({ code: "capability_activation_failed" });
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "capability_activation_failed",
      retryable: false,
    });
    data.store.close();
  });

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
      retryable: false,
    });
    data.store.close();
  });

  it("fails closed before persisting signals beyond the configured provider bound", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", { extraToolEvents: 3 });
    const run = coordinator(adapter, data.root, data.store, undefined, undefined, undefined, 4).run(
      {
        ...providerRunInput(),
        repositoryRoot: data.root,
      },
    );

    await expect(run).rejects.toMatchObject({ code: "provider_stream_failed" });
    expect(adapter.stopReason).toBe("failed");
    expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
      failureCode: "provider_stream_failed",
    });
    data.store.close();
  });

  it("rejects an invalid provider signal bound before starting the adapter", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");

    expect(() =>
      coordinator(adapter, data.root, data.store, undefined, undefined, undefined, 0),
    ).toThrow(expect.objectContaining({ code: "contract_validation_failed" }));
    expect(adapter.calls).not.toContain("start");
    expect(data.store.list({ runId })).toHaveLength(0);
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
    const run = coordinator(adapter, data.root, failOnEventType(data.store, "adapter.stopped")).run(
      { ...providerRunInput(), repositoryRoot: data.root },
    );

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
      retryable: false,
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
        const bytes = await super.get(uri);
        return Buffer.from(bytes).toString("utf8") === "fixture provider result"
          ? Buffer.from("corrupted result", "utf8")
          : bytes;
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

  it("does not emit a dangling resource observation when descriptor storage is corrupt", async () => {
    class CorruptingDescriptorStore extends MemoryArtifactStore {
      override async get(uri: string): Promise<Uint8Array> {
        await super.get(uri);
        return Buffer.from("corrupted descriptor", "utf8");
      }
    }
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const run = coordinator(
      adapter,
      data.root,
      data.store,
      undefined,
      new CorruptingDescriptorStore(),
    ).run({ ...providerRunInput(), repositoryRoot: data.root });

    await expect(run).rejects.toMatchObject({ code: "artifact_storage_failed" });
    expect(adapter.calls).toEqual([]);
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain(
      "resource.usage.recorded",
    );
    expect(data.store.list({ runId }).at(-1)?.type).toBe("run.failed");
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
