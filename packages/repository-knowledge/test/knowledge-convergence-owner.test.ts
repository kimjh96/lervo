import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";
import { knowledgeConvergenceStages } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import { SQLiteEventStore } from "../../event-store-sqlite/src/index.js";
import { canonicalJson, sha256 } from "../src/integrity.js";
import { processKnowledgeConvergence } from "../src/knowledge-convergence-owner.js";
import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  type KnowledgeConvergenceBaseline,
  type KnowledgeConvergenceHost,
  type KnowledgeConvergenceInput,
} from "../src/knowledge-convergence-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-convergence-"));
  roots.push(root);
  const projectId = "prj_0123456789abcdef";
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 4,
  });
  const cas = new Map<string, Uint8Array>();
  const artifacts: ArtifactStore = {
    put: async (content) => {
      const bytes = typeof content === "string" ? Buffer.from(content) : content;
      const contentHash = sha256(bytes);
      const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
      const created = !cas.has(uri);
      cas.set(uri, bytes);
      return { uri, contentHash, byteCount: bytes.byteLength, created };
    },
    putStream: async () => {
      throw new Error("unused");
    },
    has: async (uri) => cas.has(uri),
    get: async (uri) => cas.get(uri)!,
  };
  let current = false;
  let snapshotHash = sha256("source");
  const calls: string[] = [];
  const baseline = (): KnowledgeConvergenceBaseline => ({
    schemaVersion: 1,
    projectId,
    sourceSnapshotId: "ksnap_fixture",
    sourceSnapshotHash: snapshotHash,
    policyHash: sha256("policy"),
    debtDigest: sha256(current ? "none" : "old debt"),
    delegationHash: sha256("delegation"),
    debtCounts: {
      canonicalization: current ? 0 : 1,
      normalization: current ? 0 : 1,
      lifecycle: current ? 0 : 1,
      historical: 0,
    },
    sources: [{ path: "docs/specs/old.md", contentHash: snapshotHash, kind: "text" }],
    normalizationPaths: current ? [] : ["docs/specs/old.md"],
    historicalEvents: [],
  });
  const host: KnowledgeConvergenceHost = {
    discover: async () => baseline(),
    assertCurrent: async (input) => {
      if (input.snapshotHash !== snapshotHash)
        throw Object.assign(new Error("drift"), { code: "source_bytes_changed" });
    },
    assertSettlement: (input) => {
      if (input.snapshotHash !== snapshotHash)
        throw Object.assign(new Error("drift"), { code: "source_bytes_changed" });
    },
    dependencyCurrent: async () => true,
    runStage: async (stage, input, assertLease) => {
      assertLease();
      calls.push(stage);
      const index = knowledgeConvergenceStages.indexOf(stage);
      const proof = await artifacts.put(
        canonicalJson({
          schemaVersion: 1,
          obligationId: input.obligationId,
          stage,
          sourceSnapshotHash: snapshotHash,
          resultSnapshotHash: snapshotHash,
          policyHash: input.baseline.policyHash,
          delegationHash: input.baseline.delegationHash,
        }),
      );
      const state: KnowledgeConvergenceInput = {
        ...input,
        receipts: [...input.receipts, { stage, artifactHash: proof.contentHash, snapshotHash }],
      };
      if (stage === "lifecycle_verification") current = true;
      return {
        state: "current",
        input: state,
        assignmentId: "asn_0123456789abcdef01234567",
        leaseGeneration: sha256("lease"),
        failureCode: null,
        dependencyHash: null,
        nextStage: knowledgeConvergenceStages[index + 1] ?? null,
        ...(current ? { knowledgeSnapshotHash: snapshotHash } : {}),
      };
    },
  };
  const cycle = (maximumStages = 1, version = 4, now = () => new Date()) =>
    processKnowledgeConvergence({
      events,
      artifacts,
      host,
      workerId: "worker",
      writableEventSchemaVersion: version,
      maximumStages,
      now,
    });
  return {
    events,
    artifacts,
    host,
    calls,
    cycle,
    drift: () => {
      snapshotHash = sha256("new source");
    },
    current: () => current,
  };
}

it("discovers preexisting idle debt, resumes every durable stage, and performs no work after verified completion", async () => {
  const f = await fixture();
  try {
    for (let stage = 0; stage < 7; stage++) await f.cycle();
    expect(f.calls).toEqual([...knowledgeConvergenceStages]);
    const finished = await f.cycle();
    expect(finished).toMatchObject({
      outstanding: 0,
      state: "idle",
      lastVerifiedCurrency: { snapshotHash: sha256("source") },
    });
    expect(f.calls).toHaveLength(7);
    expect(f.events.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION)).toBe(0);
    expect(f.events.verifyIntegrity().valid).toBe(true);
    f.events.purgeAcknowledged({ before: new Date(Date.now() + 1_000).toISOString(), limit: 100 });
    await f.cycle();
    expect(f.calls).toHaveLength(7);
  } finally {
    f.events.close();
  }
});

it("retains a stage lease across a 31-minute repository verification", async () => {
  const f = await fixture();
  let clock = Date.parse("2026-09-28T10:00:00.000Z");
  const runStage = f.host.runStage;
  f.host.runStage = async (...args) => {
    clock += 31 * 60_000;
    return runStage(...args);
  };
  try {
    await f.cycle(1, 4, () => new Date(clock));
    expect(f.calls).toEqual(["assessment"]);
    expect(
      f.events
        .list({ limit: 100 })
        .some(
          (event) =>
            event.type === "repository.knowledge.stage.recorded" &&
            event.payload.state === "current",
        ),
    ).toBe(true);
  } finally {
    f.events.close();
  }
});

it("requires reader activation before creating new events or invoking stages", async () => {
  const f = await fixture();
  try {
    expect(await f.cycle(8, 3)).toMatchObject({ transport: "reader_transition_required" });
    expect(f.events.latest()).toBeNull();
    expect(f.calls).toEqual([]);
  } finally {
    f.events.close();
  }
});

it("reschedules a busy materialization without recording a failed stage", async () => {
  const f = await fixture();
  f.host.runStage = async () => {
    throw Object.assign(new Error("live reader active"), {
      code: "knowledge_materialization_busy",
    });
  };
  try {
    const status = await f.cycle(1, 4, () => new Date("2026-09-29T10:00:00.000Z"));
    expect(status).toMatchObject({ state: "retry_scheduled", outstanding: 1 });
    expect(
      f.events
        .list({ limit: 100 })
        .filter((event) => event.type === "repository.knowledge.stage.recorded"),
    ).toEqual([]);
  } finally {
    f.events.close();
  }
});

it("stores an owned dependency without busy retrying when write authority is unavailable", async () => {
  const f = await fixture();
  f.host.runStage = async (_stage, input) => ({
    state: "waiting_authority",
    input,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: "knowledge_authority_unavailable",
    dependencyHash: sha256("authority"),
    nextStage: null,
  });
  try {
    expect(await f.cycle()).toMatchObject({
      state: "waiting_authority",
      outstanding: 1,
      reason: "knowledge_authority_unavailable",
    });
    const head = f.events.latest()!.eventHash;
    await f.cycle();
    expect(f.events.latest()!.eventHash).toBe(head);
    expect(f.events.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION)).toBe(0);
  } finally {
    f.events.close();
  }
});

it("rejects lifecycle success with missing canonical or normalization stage receipts", async () => {
  const f = await fixture();
  f.host.runStage = async (_stage, input) => ({
    state: "current",
    input,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: null,
    dependencyHash: null,
    nextStage: null,
    knowledgeSnapshotHash: sha256("source"),
  });
  try {
    await expect(f.cycle()).rejects.toThrow("every stage");
    expect(
      f.events
        .list({ limit: 100 })
        .some((event) => event.type === "repository.knowledge.convergence.recorded"),
    ).toBe(false);
    expect(f.events.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION)).toBe(1);
  } finally {
    f.events.close();
  }
});

it("links a changed baseline to a successor and never dispatches its old continuation", async () => {
  const f = await fixture();
  try {
    await f.cycle();
    f.drift();
    await f.cycle(2);
    const superseded = f.events
      .list({ limit: 100 })
      .find(
        (event) =>
          event.type === "repository.knowledge.convergence.recorded" &&
          event.payload.terminalState === "superseded",
      );
    expect(superseded?.payload.successorId).toMatch(/^kconv_/u);
    expect(f.calls).toEqual(["assessment", "assessment"]);
  } finally {
    f.events.close();
  }
});

function observeCycleCost(f: Awaited<ReturnType<typeof fixture>>) {
  const counts = { discover: 0, replay: 0 };
  const discover = f.host.discover;
  f.host.discover = async () => {
    counts.discover++;
    return discover();
  };
  const list = f.events.list.bind(f.events);
  f.events.list = (options) => {
    if ((options?.afterSeq ?? 0) === 0) counts.replay++;
    return list(options);
  };
  return counts;
}

it("observes an idle current repository with one discovery and one canonical replay per cycle", async () => {
  const f = await fixture();
  try {
    for (let stage = 0; stage < 7; stage++) await f.cycle();
    await f.cycle();
    const counts = observeCycleCost(f);
    expect(await f.cycle()).toMatchObject({ state: "idle", outstanding: 0 });
    expect(counts).toEqual({ discover: 1, replay: 1 });
  } finally {
    f.events.close();
  }
});

it("observes a waiting dependency with one discovery and one canonical replay per cycle", async () => {
  const f = await fixture();
  f.host.runStage = async (_stage, input) => ({
    state: "waiting_authority",
    input,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: "knowledge_authority_unavailable",
    dependencyHash: sha256("authority"),
    nextStage: null,
  });
  try {
    await f.cycle();
    const counts = observeCycleCost(f);
    expect(await f.cycle()).toMatchObject({ state: "waiting_authority", outstanding: 1 });
    expect(counts).toEqual({ discover: 1, replay: 1 });
  } finally {
    f.events.close();
  }
});

it("discovers again for the closing status after a stage settles", async () => {
  const f = await fixture();
  try {
    const counts = observeCycleCost(f);
    await f.cycle();
    expect(f.calls).toEqual(["assessment"]);
    expect(counts.discover).toBe(2);
  } finally {
    f.events.close();
  }
});
