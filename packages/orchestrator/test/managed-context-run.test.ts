import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ContextDeliveryError } from "@roven/context-delivery";
import type { AdapterNormalizedEvent } from "@roven/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { ManagedContextError } from "../src/index.js";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  failOnEventType,
  hash,
  injectFixtureContext,
  prepareFixtureContext,
  projectId,
  receiptFor,
  role,
  runId,
  sessionId,
  targetDigest,
} from "./fixture.js";

afterEach(cleanupManagedFixtures);

describe("managed context gate orchestration", () => {
  it("records E1/E2/E3 before issuing one write permit and invalidates it after the change", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);

    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });
    expect(decision).toMatchObject({ allowed: true, assurance: "E3" });
    if (!decision.allowed) throw new Error("expected a write permit");

    const output = "export const ready = true;\n";
    await expect(
      run.recordFileChange({
        permit: decision.permit,
        path: "src/another.ts",
        beforeHash: null,
        afterHash: hash(output),
        changeKind: "created",
        occurredAt: new Date("2026-08-18T01:05:00Z"),
      }),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<ManagedContextError>>({
        code: "write_permit_invalid",
      }),
    );
    await writeFile(resolve(fixture.root, "src/result.ts"), output);
    await run.recordFileChange({
      permit: decision.permit,
      path: "src/result.ts",
      beforeHash: null,
      afterHash: hash(output),
      changeKind: "created",
      occurredAt: new Date("2026-08-18T01:05:00Z"),
    });

    expect(run.snapshot()).toMatchObject({
      phase: "awaiting_context",
      contextGeneration: 1,
      telemetryHealthy: true,
    });
    const denied = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:06:00Z"),
    });
    expect(denied).toMatchObject({
      allowed: false,
      failure: "required_context_missing",
      missing: [expect.objectContaining({ reason: "stale_context_generation" })],
    });

    const events = fixture.store.list({ runId: "run_orchestrator_01" });
    expect(events.map((event) => event.type)).toEqual([
      "context.selected",
      "context.selected",
      "document.loaded",
      "context.injected",
      "capability.requested",
      "capability.decided",
      "file.changed",
      "context.invalidated",
      "capability.requested",
      "capability.decided",
    ]);
    expect(events.find((event) => event.type === "context.invalidated")?.payload).toMatchObject({
      reason: "managed_file_changed",
      contextGeneration: 0,
    });
    expect(JSON.stringify(events)).not.toContain("저장소 작업 지침입니다");
    expect(fixture.store.verifyIntegrity().valid).toBe(true);
    fixture.store.close();
  });

  it("invalidates the generation when compaction arrives during adapter injection", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);

    await expect(
      run.injectContext({
        session: fixture.session,
        writingPolicy: null,
        targetTurnId: "turn-compaction",
        publications: [],
        injectContext: async (session, envelope) => {
          run.invalidateContext(
            "context_compacted",
            new Date("2026-08-18T01:02:30Z"),
          );
          return receiptFor(session, envelope);
        },
        now: () => new Date("2026-08-18T01:02:00Z"),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ContextDeliveryError>>({
        code: "stale_context_generation",
      }),
    );
    expect(run.snapshot()).toMatchObject({
      phase: "awaiting_context",
      contextGeneration: 1,
    });
    expect(fixture.store.list().map((event) => event.type)).not.toContain(
      "context.injected",
    );
    expect(fixture.store.list().at(-1)?.payload).toMatchObject({
      reason: "context_compacted",
      contextGeneration: 0,
    });
    fixture.store.close();
  });

  it("serializes concurrent async state transitions", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    let releaseInjection!: () => void;
    let markInjectionStarted!: () => void;
    const injectionStarted = new Promise<void>((resolve) => {
      markInjectionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseInjection = resolve;
    });
    const firstInjection = run.injectContext({
      session: fixture.session,
      writingPolicy: null,
      targetTurnId: "turn-serialized",
      publications: [],
      injectContext: async (session, envelope) => {
        markInjectionStarted();
        await release;
        return receiptFor(session, envelope);
      },
      now: () => new Date("2026-08-18T01:02:00Z"),
    });
    await injectionStarted;

    await expect(injectFixtureContext(run, fixture.session)).rejects.toEqual(
      expect.objectContaining<Partial<ManagedContextError>>({ code: "invalid_state" }),
    );
    releaseInjection();
    await expect(firstInjection).resolves.toMatchObject({
      receipt: { receiptId: "ctx_adapter_orchestrator" },
    });
    fixture.store.close();
  });

  it("closes the gate on session restart and rejects the previous E3 generation", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    run.invalidateContext("session_restarted", new Date("2026-08-18T01:04:00Z"));

    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:05:00Z"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      missing: [expect.objectContaining({ reason: "stale_context_generation" })],
    });
    fixture.store.close();
  });

  it("accepts only a bound provider compaction signal as a generation transition", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    const event: AdapterNormalizedEvent = {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: "evt_compaction01",
      projectId,
      runId,
      sessionId,
      providerSessionId: fixture.session.providerSessionId,
      type: "provider.context.compacted",
      occurredAt: "2026-08-18T01:03:30Z",
      payload: {
        providerTurnId: "provider-turn-1",
        providerItemId: "provider-compaction-1",
      },
    };

    expect(
      run.handleAdapterEvent(
        fixture.session,
        event,
        new Date("2026-08-18T01:04:00Z"),
      ),
    ).toBe(true);
    expect(run.snapshot()).toMatchObject({ phase: "awaiting_context", contextGeneration: 1 });
    expect(
      run.handleAdapterEvent(
        fixture.session,
        event,
        new Date("2026-08-18T01:05:00Z"),
      ),
    ).toBe(false);
    expect(run.snapshot().contextGeneration).toBe(1);
    expect(fixture.store.list().at(-1)?.payload).toMatchObject({
      reason: "context_compacted",
      contextGeneration: 0,
    });
    fixture.store.close();
  });

  it("rejects adapter signals from another provider session", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    const event: AdapterNormalizedEvent = {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: "evt_compaction02",
      projectId,
      runId,
      sessionId,
      providerSessionId: "other-provider-session",
      type: "provider.context.compacted",
      occurredAt: "2026-08-18T01:03:30Z",
      payload: {
        providerTurnId: "provider-turn-2",
        providerItemId: "provider-compaction-2",
      },
    };
    expect(() =>
      run.handleAdapterEvent(
        fixture.session,
        event,
        new Date("2026-08-18T01:04:00Z"),
      ),
    ).toThrow(expect.objectContaining({ code: "context_contract_invalid" }));
    expect(run.snapshot()).toMatchObject({ phase: "context_injected", contextGeneration: 0 });
    fixture.store.close();
  });

  it("detects a changed context document immediately before write authorization", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    await writeFile(resolve(fixture.root, "AGENTS.md"), "변경된 작업 지침입니다.\n");

    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });
    expect(decision).toMatchObject({ allowed: false });
    expect(run.snapshot()).toMatchObject({
      phase: "awaiting_context",
      contextGeneration: 1,
    });
    expect(
      fixture.store.list().find((event) => event.type === "context.invalidated")?.payload,
    ).toMatchObject({ reason: "content_changed", contextGeneration: 0 });
    fixture.store.close();
  });

  it("does not record a managed file change whose claimed hash differs from the repository", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });
    if (!decision.allowed) throw new Error("expected a write permit");
    await writeFile(resolve(fixture.root, "src/result.ts"), "actual bytes\n");

    await expect(
      run.recordFileChange({
        permit: decision.permit,
        path: "src/result.ts",
        beforeHash: null,
        afterHash: hash("claimed bytes\n"),
        changeKind: "created",
        occurredAt: new Date("2026-08-18T01:05:00Z"),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ManagedContextError>>({
        code: "file_snapshot_invalid",
      }),
    );
    expect(run.snapshot()).toMatchObject({
      phase: "awaiting_context",
      contextGeneration: 1,
    });
    expect(fixture.store.list().map((event) => event.type)).not.toContain("file.changed");
    expect(fixture.store.list().at(-1)?.payload).toMatchObject({
      reason: "file_change_unverified",
      contextGeneration: 0,
    });
    fixture.store.close();
  });

  it.each([
    ["deny", "capability_denied"],
    ["require_approval", "approval_required"],
  ] as const)("does not let valid E3 override the role write policy %s", async (
    writePolicy,
    expectedFailure,
  ) => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun();
    await prepareFixtureContext(run, fixture.root, {
      ...role,
      capabilities: { ...role.capabilities, "filesystem.write": writePolicy },
    });
    await injectFixtureContext(run, fixture.session);

    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      assurance: "E3",
      failure: expectedFailure,
    });
    expect(fixture.store.list().at(-1)?.payload).toMatchObject({
      capability: "filesystem.write",
      decision: writePolicy,
    });
    fixture.store.close();
  });

  it("rolls back partial context telemetry and permanently fails closed", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun(failOnEventType(fixture.store, "document.loaded"));

    await expect(prepareFixtureContext(run, fixture.root)).rejects.toEqual(
      expect.objectContaining<Partial<ManagedContextError>>({
        code: "telemetry_recording_failed",
        failure: "telemetry_recording_failed",
      }),
    );
    expect(fixture.store.list()).toEqual([]);
    expect(run.snapshot()).toMatchObject({
      phase: "telemetry_failed",
      contextGeneration: 1,
      telemetryHealthy: false,
    });
    const denied = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });
    expect(denied).toMatchObject({
      allowed: false,
      failure: "telemetry_recording_failed",
    });
    fixture.store.close();
  });

  it("invalidates an existing E3 when capability telemetry cannot commit", async () => {
    const fixture = await createManagedFixture();
    const run = fixture.createRun(
      failOnEventType(fixture.store, "capability.decided"),
    );
    await prepareFixtureContext(run, fixture.root);
    await injectFixtureContext(run, fixture.session);
    const eventCountBeforeRequest = fixture.store.list().length;

    const decision = await run.authorizeFileWrite({
      path: "src/result.ts",
      targetDigest,
      risk: "low",
      publications: [],
      occurredAt: new Date("2026-08-18T01:04:00Z"),
    });

    expect(decision).toMatchObject({
      allowed: false,
      failure: "telemetry_recording_failed",
    });
    expect(fixture.store.list()).toHaveLength(eventCountBeforeRequest);
    expect(fixture.store.list().at(-1)?.type).toBe("context.injected");
    expect(run.snapshot()).toMatchObject({
      phase: "telemetry_failed",
      contextGeneration: 1,
      telemetryHealthy: false,
    });
    fixture.store.close();
  });
});
