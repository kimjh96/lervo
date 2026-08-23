import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
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
import { clock, coordinator } from "./managed-provider-run-test-harness.js";
import { FakeManagedAdapter } from "./provider-run-fake-adapter.js";

afterEach(cleanupManagedFixtures);

describe("managed provider run lifecycle", () => {
  it("rolls back run start when skill resolution evidence cannot be recorded", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();
    await expect(coordinator(
      adapter,
      data.root,
      failOnEventType(data.store, "skill.resolved"),
    ).run({
      ...input,
      repositoryRoot: data.root,
      context: {
        ...input.context,
        role: { ...input.context.role, defaultSkills: ["repository/testing"] },
      },
      resolvedSkills: [{
        skillId: "repository/testing",
        version: "1.0.0",
        contentHash: `sha256:${"a".repeat(64)}`,
        sourceKind: "project",
        trustStatus: "untrusted",
      }],
    })).rejects.toMatchObject({ code: "telemetry_recording_failed" });

    expect(data.store.list({ runId })).toEqual([]);
    expect(adapter.calls).toEqual([]);
    data.store.close();
  });

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
      expect(serialized).not.toContain("Read the repository and explain the result");
      expect(serialized).not.toContain("fixture provider result");
      expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
        resultDigest: result.resultArtifact.contentHash,
        artifactIds: [result.resultArtifact.artifactId],
      });
      expect(data.store.verifyIntegrity().valid).toBe(true);
      data.store.close();
    },
  );

  it("allows a read-only run to declare no write target paths", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();

    await expect(coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      context: { ...input.context, expectedPaths: [] },
    })).resolves.toMatchObject({
      status: "completed",
      session: { executionMode: "read_only" },
      managedChanges: [],
    });
    data.store.close();
  });

  it.each(["missing", "duplicate"] as const)(
    "rejects a multi-file run with a %s target turn ID source before provider startup",
    async (scenario) => {
      const data = await createManagedFixture();
      const adapter = new FakeManagedAdapter("codex");
      const input = providerRunInput();

      await expect(coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        context: {
          ...input.context,
          role,
          expectedPaths: ["src/other.ts", "src/result.ts"],
        },
        ...(scenario === "duplicate"
          ? { createTargetTurnId: () => input.targetTurnId }
          : {}),
      })).rejects.toMatchObject({ code: "contract_validation_failed" });

      expect(adapter.calls).toEqual([]);
      expect(data.store.list({ runId })).toEqual([]);
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
      code: "provider_write_failed",
      paths: ["src/result.ts"],
      relatedFailures: expect.arrayContaining([
        expect.objectContaining({ code: "provider_write_failed", phase: "provider_write" }),
        expect.objectContaining({ code: "unmanaged_change_detected" }),
      ]),
    });
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain("file.changed");
    data.store.close();
  });

  it("fails when an approved write never reports completion", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("claude", {
      managedWrite: {
        path: "src/result.ts",
        targetDigest,
        changeKind: "created",
        apply: () => writeFile(resolve(data.root, "src/result.ts"), "pending\n"),
        skipCompletion: true,
      },
    });
    const input = providerRunInput();

    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        context: { ...input.context, role },
      }),
    ).rejects.toMatchObject({
      code: "provider_write_failed",
      relatedFailures: expect.arrayContaining([
        expect.objectContaining({ phase: "provider_write" }),
      ]),
    });
    data.store.close();
  });

  it.each(["duplicateAuthorization", "duplicateCompletion"] as const)(
    "rejects %s for the same provider write",
    async (duplicate) => {
      const data = await createManagedFixture();
      const adapter = new FakeManagedAdapter("codex", {
        managedWrite: {
          path: "src/result.ts",
          targetDigest,
          changeKind: "created",
          apply: () => writeFile(resolve(data.root, "src/result.ts"), "duplicate\n"),
          [duplicate]: true,
        },
      });
      const input = providerRunInput();

      await expect(
        coordinator(adapter, data.root, data.store).run({
          ...input,
          repositoryRoot: data.root,
          context: { ...input.context, role },
        }),
      ).rejects.toMatchObject({
        code: "contract_validation_failed",
        relatedFailures: expect.arrayContaining([
          expect.objectContaining({ phase: "provider_write" }),
        ]),
      });
      data.store.close();
    },
  );

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
    const artifacts = await FileSystemCas.open(resolve(data.root, ".lervo/state/cas"));
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

});
