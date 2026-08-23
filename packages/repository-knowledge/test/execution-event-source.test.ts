import { canonicalJson, computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";
import { collectExecutionEventSources } from "../src/execution-event-source.js";

function event(payload: Record<string, unknown> = {
  requestDigest: `sha256:${"a".repeat(64)}`,
  role: "developer",
  risk: "low",
}): EventEnvelope {
  const withoutHash: Omit<EventEnvelope, "eventHash"> = {
    eventId: "evt_executionfixture",
    projectId: "prj_executionfixture",
    runId: "run_executionfixture",
    sessionId: "ses_executionfixture",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-08-23T00:00:00.000Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: `sha256:${"b".repeat(64)}`,
    payload,
    previousHash: null,
  };
  return { ...withoutHash, eventHash: computeEventHash(withoutHash) };
}

function store(value: EventEnvelope): Pick<EventStore, "latest" | "list" | "verifyIntegrity"> {
  return {
    latest: () => value,
    list: (options) => value.seq > (options?.afterSeq ?? 0) ? [value].slice(0, options?.limit) : [],
    verifyIntegrity: () => ({ valid: true, eventCount: 1, headHash: value.eventHash }),
  };
}

describe("execution event knowledge source", () => {
  it("turns one validated privacy-allowlisted chain event into a canonical supplemental unit", async () => {
    const value = event();
    const sources = collectExecutionEventSources({ events: store(value) });
    expect(sources).toEqual([expect.objectContaining({
      path: `@event/${value.eventId}`,
      kind: "execution_event",
      origin: "execution_event_store",
      unitKind: "event",
      locator: `event:${value.eventId}`,
      content: `${canonicalJson(value)}\n`,
    })]);
    const root = await mkdtemp(resolve(tmpdir(), "lervo-execution-event-source-"));
    try {
      const scan = await scanRepositoryKnowledge({
        repositoryRoot: root,
        projectId: value.projectId,
        policy: defaultRepositoryKnowledgePolicy,
        supplementalSources: sources,
        observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
      });
      const unit = scan.units.find((item) => item.path === sources[0]!.path)!;
      expect(unit).toMatchObject({
        unitKind: "event",
        locator: `event:${value.eventId}`,
        range: { startByte: 0, endByte: Buffer.byteLength(sources[0]!.content) },
      });
      expect(scan.snapshotId).not.toBe(scan.contentSnapshotId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a rehashed event contains a payload field outside the event allowlist", () => {
    const privateValue = "private-event-fixture";
    const value = event({ requestDigest: `sha256:${"a".repeat(64)}`, role: "developer", risk: "low", prompt: privateValue });
    expect(() => collectExecutionEventSources({ events: store(value) })).toThrowError(expect.objectContaining({ code: "knowledge_evidence_source_invalid" }));
    expect(() => collectExecutionEventSources({ events: store(value) })).not.toThrow(privateValue);
  });
});
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
