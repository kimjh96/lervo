import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { acquireRepositorySourceWrite } from "@lervo/project-storage";
import {
  managedContextReferenceComment,
  managedContextReferenceToken,
} from "@lervo/adapter-contract";
import type { ExecutionStagesObservedEventPayload } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  admitManagedWorkCausality,
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
  it("does not start a provider while knowledge materialization owns repository sources", async () => {
    const data = await createManagedFixture();
    const lease = await acquireRepositorySourceWrite(data.root);
    const adapter = new FakeManagedAdapter("codex");
    try {
      await expect(
        coordinator(adapter, data.root, data.store).run({
          ...providerRunInput(),
          repositoryRoot: data.root,
        }),
      ).rejects.toMatchObject({ code: "repository_snapshot_failed" });
      expect(adapter.calls).toEqual([]);
    } finally {
      lease.release();
      data.store.close();
    }
  });

  it("holds its repository reader through the provider turn", async () => {
    const data = await createManagedFixture();
    let writerExcluded = false;
    const adapter = new FakeManagedAdapter("codex", {
      mutate: async () => {
        await expect(acquireRepositorySourceWrite(data.root)).rejects.toMatchObject({
          code: "repository_source_busy",
        });
        writerExcluded = true;
      },
    });
    try {
      const result = await coordinator(adapter, data.root, data.store).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      });
      expect(result.status).toBe("completed");
      expect(writerExcluded).toBe(true);
      const writer = await acquireRepositorySourceWrite(data.root);
      writer.release();
    } finally {
      data.store.close();
    }
  });

  it("rejects a second launch of one canonical run before starting its provider", async () => {
    const data = await createManagedFixture();
    try {
      await coordinator(new FakeManagedAdapter("codex"), data.root, data.store).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      });
      const second = new FakeManagedAdapter("codex");
      await expect(
        coordinator(second, data.root, data.store).run({
          ...providerRunInput(),
          repositoryRoot: data.root,
        }),
      ).rejects.toMatchObject({ code: "contract_validation_failed" });
      expect(second.calls).toEqual([]);
      expect(
        data.store.list({ runId }).filter((event) => event.type === "run.requested"),
      ).toHaveLength(1);
    } finally {
      data.store.close();
    }
  });
  it("attributes post-run snapshots separately from provider shutdown", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    let nanoseconds = 0n;
    const result = await new ManagedProviderRunCoordinator({
      adapter,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      policyVersion,
      events: data.store,
      artifactStore: new MemoryArtifactStore(),
      now: clock(),
      createEventId: sequenceFactory("evt_stages"),
      stageTiming: {
        clock: () => {
          nanoseconds += 1_000_000n;
          return nanoseconds;
        },
      },
    }).run({ ...providerRunInput(), repositoryRoot: data.root });
    expect(result.status).toBe("completed");
    const stages = (
      data.store.list({ runId }).find((event) => event.type === "execution.stages.observed")!
        .payload as ExecutionStagesObservedEventPayload
    ).stages;
    expect(stages.find((stage) => stage.stageId === "repository_snapshot")?.durationMs).toBe(2);
    expect(stages.find((stage) => stage.stageId === "provider_stop")?.durationMs).toBe(1);
    data.store.close();
  });

  it("blocks a version-1 writer before provider startup or partial admission", async () => {
    const data = await createManagedFixture();
    const path = data.store.path;
    data.store.close();
    const versionOne = await SQLiteEventStore.open({ path, projectId });
    const adapter = new FakeManagedAdapter("codex");

    await expect(
      coordinator(adapter, data.root, versionOne).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      }),
    ).rejects.toMatchObject({ code: "telemetry_recording_failed" });
    expect(adapter.calls).toEqual([]);
    expect(versionOne.list()).toEqual([]);
    versionOne.close();
  });

  it("shares the causal contract between roots and subagents without provider coupling", async () => {
    const data = await createManagedFixture();
    const rootAdapter = new FakeManagedAdapter("codex");
    const root = await coordinator(rootAdapter, data.root, data.store).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
    });
    const childAdapter = new FakeManagedAdapter("claude");
    const childRunId = "run_subagent_fixture";
    const child = await new ManagedProviderRunCoordinator({
      adapter: childAdapter,
      coordinates: {
        projectId,
        runId: childRunId,
        sessionId: "ses_subagent_fixture",
        roleId: role.roleId,
      },
      policyVersion,
      events: data.store,
      artifactStore: new MemoryArtifactStore(),
      now: clock(),
      createEventId: sequenceFactory("evt_subagent"),
    }).run({
      ...providerRunInput(),
      repositoryRoot: data.root,
      workCausality: {
        relationship: "subagent",
        workId: root.workCausality.workId,
        parentRunId: root.session.runId,
        agentId: `agt_${"a".repeat(24)}`,
      },
    });

    expect(child.workCausality).toMatchObject({
      relationship: "subagent",
      workId: root.workCausality.workId,
      parentRunId: root.session.runId,
    });
    const causal = data.store
      .list({ limit: 1000 })
      .filter((event) => event.type === "work.causality.recorded");
    expect(causal.filter((event) => event.payload.relationship === "root")).toHaveLength(1);
    expect(childAdapter.calls[0]).toBe("start");
    data.store.close();
  });

  it("rejects a subagent with missing ancestry before provider startup", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
        workCausality: {
          relationship: "subagent",
          workId: `wrk_${"b".repeat(24)}`,
          parentRunId: "run_missing_parent",
        },
      }),
    ).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.calls).toEqual([]);
    expect(data.store.list()).toEqual([]);
    data.store.close();
  });

  it("continues after a crash that persisted only the exact causal admission", async () => {
    const data = await createManagedFixture();
    const persistedAt = "2026-08-18T00:59:00.000Z";
    const admission = admitManagedWorkCausality({
      events: data.store,
      coordinates: { projectId, runId, sessionId, roleId: role.roleId },
      occurredAt: persistedAt,
    });
    data.store.append({
      ...admission.spec,
      eventId: admission.spec.eventId!,
      projectId,
      runId,
      sessionId,
      policyVersion,
      schemaVersion: 2,
    });

    const adapter = new FakeManagedAdapter("codex");
    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      }),
    ).resolves.toMatchObject({ status: "completed" });

    const causal = data.store
      .list({ runId })
      .filter((event) => event.type === "work.causality.recorded");
    expect(causal).toHaveLength(1);
    expect(causal[0]?.occurredAt).toBe(persistedAt);
    expect(adapter.calls[0]).toBe("start");
    data.store.close();
  });

  it("rolls back run start when skill resolution evidence cannot be recorded", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();
    await expect(
      coordinator(adapter, data.root, failOnEventType(data.store, "skill.resolved")).run({
        ...input,
        repositoryRoot: data.root,
        context: {
          ...input.context,
          role: { ...input.context.role, defaultSkills: ["repository/testing"] },
        },
        resolvedSkills: [
          {
            skillId: "repository/testing",
            version: "1.0.0",
            contentHash: `sha256:${"a".repeat(64)}`,
            sourceKind: "project",
            trustStatus: "untrusted",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "telemetry_recording_failed" });

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
      expect(Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString("utf8")).toBe(
        "fixture provider result",
      );
      expect(adapter.calls).toEqual([
        "start",
        "inspectProcess",
        "injectContext",
        "attachManagedWriteBridge",
        "startTurn",
        "inspectProcess",
        "getTurnResult",
        "inspectProcess",
        "stop",
      ]);
      expect(adapter.stopReason).toBe("completed");
      expect(data.store.list({ runId }).map((event) => event.type)).toEqual([
        "work.causality.recorded",
        "run.requested",
        "run.resolved",
        "adapter.started",
        "provider.process.observed",
        "context.selected",
        "context.selected",
        "document.loaded",
        "context.injected",
        "tool.called",
        "command.executed",
        "provider.process.observed",
        "adapter.result.captured",
        "provider.process.observed",
        "adapter.stopped",
        "resource.usage.recorded",
        "execution.stages.observed",
        "run.completed",
      ]);
      const serialized = JSON.stringify(data.store.list({ runId }));
      expect(serialized).not.toContain("Read the repository and explain the result");
      expect(serialized).not.toContain("fixture provider result");
      const processEvents = data.store
        .list({ runId })
        .filter((event) => event.type === "provider.process.observed");
      expect(JSON.stringify(processEvents)).not.toContain(`${provider}-session-1`);
      expect(processEvents.map((event) => event.payload)).toEqual([
        expect.objectContaining({
          phase: "session_started",
          status: "running",
          evidence: "owned_process_state",
          releasesAgentAuthority: false,
          releasesAssignmentAuthority: false,
          provesWorkProgress: false,
        }),
        expect.objectContaining({ phase: "turn_terminal", status: "running" }),
        expect.objectContaining({ phase: "before_stop", status: "running" }),
      ]);
      expect(data.store.list({ runId }).at(-1)?.payload).toMatchObject({
        resultDigest: result.resultArtifact.contentHash,
        artifactIds: [result.resultArtifact.artifactId],
      });
      expect(data.store.verifyIntegrity().valid).toBe(true);
      data.store.close();
    },
  );

  it("fails closed and stops the adapter when process evidence changes session coordinates", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    adapter.inspectProcess = (session) => ({
      kind: "process_observation",
      schemaVersion: 1,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: "ses_wrong_process_observation",
      providerSessionId: session.providerSessionId,
      status: "running",
      evidence: "owned_process_state",
      observedAt: session.startedAt,
    });

    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...providerRunInput(),
        repositoryRoot: data.root,
      }),
    ).rejects.toMatchObject({ code: "contract_validation_failed" });
    expect(adapter.calls).toContain("stop");
    expect(adapter.calls).not.toContain("startTurn");
    data.store.close();
  });

  it("records provider-confirmed activation before starting the managed turn", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();
    const result = await coordinator(adapter, data.root, data.store).run({
      ...input,
      repositoryRoot: data.root,
      capabilityActivations: [
        {
          kind: "capability_activation_request",
          schemaVersion: 1,
          capabilityId: "plugins/research",
          capabilityKind: "provider_plugin",
          version: "1.0.0",
          contentHash: `sha256:${"a".repeat(64)}`,
          runtime: {
            kind: "provider_plugin",
            provider: "codex",
            pluginRoot: "/immutable/plugins/research",
            pluginManifestPath: ".codex-plugin/plugin.json",
          },
        },
      ],
    });

    expect(result.capabilityActivations).toHaveLength(1);
    expect(adapter.calls.indexOf("confirmCapabilityActivation")).toBeLessThan(
      adapter.calls.indexOf("startTurn"),
    );
    expect(
      data.store.list({ runId }).filter((event) => event.type === "capability.activated"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          capabilityId: "plugins/research",
          evidence: "plugin_loaded",
        }),
      }),
    ]);
    data.store.close();
  });

  it("fails closed before the turn when provider activation cannot be confirmed", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", { failActivation: true });
    const input = providerRunInput();
    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        capabilityActivations: [
          {
            kind: "capability_activation_request",
            schemaVersion: 1,
            capabilityId: "plugins/research",
            capabilityKind: "provider_plugin",
            version: "1.0.0",
            contentHash: `sha256:${"a".repeat(64)}`,
            runtime: {
              kind: "provider_plugin",
              provider: "codex",
              pluginRoot: "/immutable/plugins/research",
              pluginManifestPath: ".codex-plugin/plugin.json",
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "capability_activation_failed" });
    expect(adapter.calls).not.toContain("startTurn");
    expect(data.store.list({ runId }).map((event) => event.type)).not.toContain(
      "capability.activated",
    );
    data.store.close();
  });

  it.each([
    ["codex", "markdown"],
    ["claude", "markdown"],
    ["codex", "json"],
    ["claude", "json"],
  ] as const)(
    "records exact managed E4 output citations for %s %s without retaining the result body",
    async (provider, resultFormat) => {
      const data = await createManagedFixture();
      await writeFile(resolve(data.root, "task-evidence.md"), "Direct task evidence.\n");
      const artifactStore = new MemoryArtifactStore();
      const adapter = new FakeManagedAdapter(provider, {
        resultContent: (envelope) => {
          const rationale = `Applied repository guidance.\n\n${managedContextReferenceComment(
            envelope.documents.find((document) => document.referenceEligible)!,
          )}`;
          return resultFormat === "json"
            ? JSON.stringify({ rationale, details: { accepted: true } })
            : rationale;
        },
      });
      const input = providerRunInput();
      input.context.registry.documents.doc_task_evidence1 = {
        path: "task-evidence.md",
        kind: "canonical",
        responsibleParty: { kind: "team", id: "team_fixture" },
        connectedPaths: ["src/**"],
        verifiedRevision: "fixture-v1",
        verifiedAt: "2026-08-18T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      };
      const result = await coordinator(
        adapter,
        data.root,
        data.store,
        undefined,
        artifactStore,
      ).run({
        ...input,
        repositoryRoot: data.root,
        resultFormat,
      });
      const referenced = result.contextEvidence.filter((item) => item.state === "referenced");
      expect(referenced).toHaveLength(1);
      expect(referenced[0]).toMatchObject({
        documentId: result.contextEvidence.find(
          (item) => item.state === "injected" && item.documentId === referenced[0]!.documentId,
        )?.documentId,
        referenceKind: "output_citation",
      });
      const events = data.store.list({ runId });
      expect(events.filter((event) => event.type === "adapter.result.captured")).toHaveLength(1);
      expect(events.filter((event) => event.type === "context.referenced")).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain("Applied repository guidance");
      const publication = Buffer.from(await artifactStore.get(result.resultArtifact.uri)).toString(
        "utf8",
      );
      if (resultFormat === "json") {
        expect(JSON.parse(publication)).toEqual({
          rationale: "Applied repository guidance.\n\n",
          details: { accepted: true },
        });
      } else {
        expect(publication).toBe("Applied repository guidance.\n\n");
      }
      expect(result.resultArtifact.contentHash).not.toBe(
        events.find((event) => event.type === "adapter.result.captured")?.payload.resultDigest,
      );
      data.store.close();
    },
  );

  it("fails closed when a known context reference is not a standalone comment", async () => {
    const data = await createManagedFixture();
    try {
      await writeFile(resolve(data.root, "task-evidence.md"), "Direct task evidence.\n");
      const adapter = new FakeManagedAdapter("codex", {
        resultContent: (envelope) => {
          const document = envelope.documents.find((item) => item.referenceEligible)!;
          return `Applied guidance <!-- ${managedContextReferenceToken(document)} --> inline.`;
        },
      });
      const input = providerRunInput();
      input.context.registry.documents.doc_task_evidence1 = {
        path: "task-evidence.md",
        kind: "canonical",
        responsibleParty: { kind: "team", id: "team_fixture" },
        connectedPaths: ["src/**"],
        verifiedRevision: "fixture-v1",
        verifiedAt: "2026-08-18T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      };

      await expect(
        coordinator(adapter, data.root, data.store).run({
          ...input,
          repositoryRoot: data.root,
        }),
      ).rejects.toMatchObject({ code: "contract_validation_failed" });
      expect(data.store.list({ runId }).map((event) => event.type)).not.toContain(
        "context.referenced",
      );
    } finally {
      data.store.close();
    }
  });

  it("allows a read-only run to declare no write target paths", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();

    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        context: { ...input.context, expectedPaths: [] },
      }),
    ).resolves.toMatchObject({
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

      await expect(
        coordinator(adapter, data.root, data.store).run({
          ...input,
          repositoryRoot: data.root,
          context: {
            ...input.context,
            role,
            expectedPaths: ["src/other.ts", "src/result.ts"],
          },
          ...(scenario === "duplicate" ? { createTargetTurnId: () => input.targetTurnId } : {}),
        }),
      ).rejects.toMatchObject({ code: "contract_validation_failed" });

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
      data.store.list({ runId }).find((event) => event.type === "unmanaged_change.detected")
        ?.payload,
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

    expect(Buffer.from(await artifacts.get(result.resultArtifact.uri)).toString("utf8")).toBe(
      "fixture provider result",
    );
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
    expect(
      data.store.list({ runId }).find((event) => event.type === "unmanaged_change.detected")
        ?.payload,
    ).toMatchObject({
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
      list: () => [],
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
      expect(adapter.turnRequests).toHaveLength(1);
      expect(adapter.turnRequests[0]?.instructions).toBe(
        [
          input.instructions,
          "",
          "Lervo managed file 1/1: src/result.ts",
          "Change only the repository-relative path above in this turn.",
          "Submit its complete change through exactly one provider file-change request; a second request fails the run.",
        ].join("\n"),
      );
      const events = data.store.list({ runId });
      expect(events.map((event) => event.type)).toContain("file.changed");
      expect(events.map((event) => event.type)).not.toContain("unmanaged_change.detected");
      expect(JSON.stringify(events)).not.toContain(output.trim());
      data.store.close();
    },
  );
});
