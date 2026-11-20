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
  // A stage named here commits: it moves the repository and its own input to new bytes.
  let commitAt: string | null = null;
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
      // A committing stage reads its input bytes and leaves the committed bytes behind; its proof
      // must name both, as a real stage receipt does.
      if (stage === commitAt) {
        commitAt = null;
        snapshotHash = sha256("committed");
      }
      const proof = await artifacts.put(
        canonicalJson({
          schemaVersion: 1,
          obligationId: input.obligationId,
          stage,
          sourceSnapshotHash: input.snapshotHash,
          resultSnapshotHash: snapshotHash,
          policyHash: input.baseline.policyHash,
          delegationHash: input.baseline.delegationHash,
        }),
      );
      const state: KnowledgeConvergenceInput = {
        ...input,
        snapshotHash,
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
    commitAt: (stage: string) => {
      commitAt = stage;
    },
    // A supersession or publication sync resets the obligation's own commit.
    revert: () => {
      snapshotHash = sha256("source");
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
    expect(status).toMatchObject({
      state: "retry_scheduled",
      outstanding: 1,
      retry: { attemptCount: 1, attemptLimit: 16, nextAttemptAt: "2026-09-29T10:01:00.000Z" },
    });
    expect(
      f.events
        .list({ limit: 100 })
        .filter((event) => event.type === "repository.knowledge.stage.recorded"),
    ).toEqual([]);
  } finally {
    f.events.close();
  }
});

it("escalates a repeated untyped stage failure from a visible retry schedule to attention", async () => {
  const f = await fixture();
  let clock = Date.parse("2026-10-06T01:49:56.096Z");
  const evidence = sha256("private stage failure");
  f.host.runStage = async () => {
    // The shape of a failed `git rev-parse` for an integration ref that this host never created.
    throw Object.assign(new Error("Command failed: git rev-parse"), {
      code: 128,
      dependencyHash: evidence,
    });
  };
  const cycle = () => f.cycle(1, 4, () => new Date(clock));
  try {
    expect(await cycle()).toMatchObject({
      state: "retry_scheduled",
      reason: "knowledge_stage_failure_unclassified",
      retry: { attemptCount: 1, attemptLimit: 4, nextAttemptAt: "2026-10-06T01:50:56.096Z" },
    });
    clock += 30_000;
    expect(await cycle()).toMatchObject({ retry: { attemptCount: 1 } });
    clock += 60_000;
    expect(await cycle()).toMatchObject({ retry: { attemptCount: 2 } });
    clock += 120_000;
    expect(await cycle()).toMatchObject({ retry: { attemptCount: 3 } });
    clock += 240_000;
    const settled = await cycle();
    expect(settled).toMatchObject({
      state: "attention_required",
      reason: "knowledge_stage_failure_unclassified",
      outstanding: 1,
    });
    expect(settled.retry).toBeUndefined();
    const stage = f.events
      .list({ limit: 100 })
      .findLast((event) => event.type === "repository.knowledge.stage.recorded")!;
    expect(stage.payload).toMatchObject({
      state: "attention_required",
      failureCode: "knowledge_stage_failure_unclassified",
    });
    const dependency = JSON.parse(
      Buffer.from(
        await f.artifacts.get(
          `lervo-cas://sha256/${(stage.payload.dependencyHash as string).slice(7)}`,
        ),
      ).toString("utf8"),
    );
    expect(dependency).toMatchObject({
      code: "knowledge_stage_failure_unclassified",
      evidenceHash: evidence,
      reevaluateAt: new Date(clock + 6 * 60 * 60_000).toISOString(),
    });
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

it.each([
  ["knowledge_semantic_review_invalid", "attention_required"],
  ["knowledge_effect_uncertain", "recovery_required"],
] as const)("settles a stage that throws %s as %s without rerunning it", async (code, state) => {
  const f = await fixture();
  const evidence = sha256(`${code} observation`);
  let runs = 0;
  f.host.runStage = async () => {
    runs++;
    throw Object.assign(new Error(code), { code, dependencyHash: evidence });
  };
  try {
    expect(await f.cycle()).toMatchObject({ state, reason: code, outstanding: 1 });
    expect(f.events.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION)).toBe(0);
    const stage = f.events
      .list({ limit: 100 })
      .findLast((event) => event.type === "repository.knowledge.stage.recorded")!;
    expect(stage.payload).toMatchObject({ stage: "assessment", state, failureCode: code });
    const head = f.events.latest()!.eventHash;
    await f.cycle();
    expect(runs).toBe(1);
    expect(f.events.latest()!.eventHash).toBe(head);
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

it("lets the host settle a stage before the pre-stage currency check rejects it", async () => {
  // digimon after ADR-0486: the owner's pre-stage check threw review_context_stale before the
  // host's stage could regenerate the review, so the review stalled at attention every cycle.
  const f = await fixture();
  const assertCurrent = f.host.assertCurrent;
  // Discovery checks the new obligation once; the waiting stage's bound context is stale after.
  let checks = 0;
  let staleContext = true;
  f.host.assertCurrent = async (input) => {
    checks += 1;
    if (checks > 1 && staleContext)
      throw Object.assign(new Error("stale"), { code: "review_context_stale" });
    return assertCurrent(input);
  };
  f.host.prepareStage = async (stage, input) => {
    staleContext = false;
    f.calls.push(`prepared:${stage}`);
    return {
      state: "current",
      input,
      assignmentId: null,
      leaseGeneration: null,
      failureCode: null,
      dependencyHash: null,
      nextStage: stage,
    };
  };
  try {
    await f.cycle(1);
    expect(f.calls).toEqual(["prepared:assessment"]);
    const recorded = f.events
      .list({ limit: 100, types: ["repository.knowledge.stage.recorded"] })
      .map((event) => event.payload as { state: string; failureCode: string | null });
    expect(recorded.some((payload) => payload.failureCode === "review_context_stale")).toBe(false);
    expect(recorded.some((payload) => payload.state === "current")).toBe(true);
  } finally {
    f.events.close();
  }
});

it("waits for provider admission without attempts and resumes the same stage when admitted", async () => {
  const f = await fixture();
  const run = f.host.runStage;
  let admitted = false;
  f.host.runStage = async (...args) => {
    if (!admitted)
      throw Object.assign(new Error("No admitted provider"), { code: "provider_not_admitted" });
    return run(...args);
  };
  f.host.dependencyCurrent = async () => !admitted;
  try {
    expect(await f.cycle()).toMatchObject({
      state: "waiting_authority",
      reason: "provider_not_admitted",
    });
    const count = f.calls.length;
    expect(await f.cycle()).toMatchObject({
      state: "waiting_authority",
      reason: "provider_not_admitted",
    });
    expect(f.calls).toHaveLength(count);
    admitted = true;
    expect(await f.cycle(8)).toMatchObject({ state: "idle", outstanding: 0 });
    expect(f.calls[0]).toBe("assessment");
  } finally {
    f.events.close();
  }
});

/** The real host: a stall's dependency is current only while the repository is at its bytes. */
function snapshotDependencies(f: Awaited<ReturnType<typeof fixture>>) {
  f.host.dependencyCurrent = async (hash) => {
    const dependency = JSON.parse(
      Buffer.from(await f.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`)).toString("utf8"),
    ) as { snapshotHash?: string };
    return dependency.snapshotHash === (await f.host.discover()).sourceSnapshotHash;
  };
}

function stageRecords(f: Awaited<ReturnType<typeof fixture>>) {
  return f.events
    .list({ limit: 1_000 })
    .filter((event) => event.type === "repository.knowledge.stage.recorded")
    .map(
      (event) =>
        event.payload as {
          stage: string;
          state: string;
          failureCode: string | null;
          nextObligationId: string | null;
          dependencyHash: string | null;
        },
    );
}

it("rewinds an obligation whose own commit was reset to its baseline (ADR-0600)", async () => {
  const f = await fixture();
  snapshotDependencies(f);
  try {
    // flemo, 2026-11-14: canonical integration commits, then a reset puts the baseline back.
    f.commitAt("canonical_integration");
    await f.cycle(3);
    f.revert();
    await f.cycle();
    expect(stageRecords(f).at(-1)).toMatchObject({
      stage: "normalization_generation",
      state: "stale",
      failureCode: "source_bytes_changed",
    });
    for (let index = 0; index < 12 && !f.current(); index++) await f.cycle(8);
    expect(f.current()).toBe(true);
    // One stale record, then one rewind to assessment; no stale and queued pairs repeat.
    expect(stageRecords(f).filter((record) => record.state === "stale")).toHaveLength(1);
    expect(f.calls.filter((stage) => stage === "assessment")).toHaveLength(2);
  } finally {
    f.events.close();
  }
});

it("never requeues a stale stage at bytes the repository has left", async () => {
  const f = await fixture();
  snapshotDependencies(f);
  try {
    f.commitAt("canonical_integration");
    await f.cycle(3);
    f.revert();
    await f.cycle();
    const before = stageRecords(f).length;
    await f.cycle(1);
    const after = stageRecords(f).slice(before);
    expect(after.some((record) => record.stage === "normalization_generation")).toBe(false);
    expect(after[0]).toMatchObject({ stage: "assessment" });
  } finally {
    f.events.close();
  }
});

it("settles a mismatch that never clears as retry exhaustion instead of looping (ADR-0600)", async () => {
  const f = await fixture();
  snapshotDependencies(f);
  // The stage keeps reading bytes the repository was never at, though discovery sees no move.
  f.host.assertCurrent = async (input) => {
    if (input.receipts.length > 0)
      throw Object.assign(new Error("drift"), { code: "source_bytes_changed" });
  };
  try {
    for (let index = 0; index < 24; index++) await f.cycle();
    const records = stageRecords(f);
    expect(records.at(-1)).toMatchObject({
      state: "attention_required",
      failureCode: "knowledge_retry_exhausted",
    });
    const settled = records.length;
    await f.cycle();
    await f.cycle();
    expect(stageRecords(f)).toHaveLength(settled);
  } finally {
    f.events.close();
  }
});

it("settles an obligation whose effects keep being undone as attention after three rewinds (ADR-0600)", async () => {
  const f = await fixture();
  snapshotDependencies(f);
  try {
    // Every run commits at canonical integration and something resets it, again and again.
    f.commitAt("canonical_integration");
    await f.cycle(3);
    for (let round = 0; round < 6; round++) {
      f.revert();
      await f.cycle();
      f.commitAt("canonical_integration");
      await f.cycle(3);
    }
    const records = stageRecords(f);
    const undone = records.filter(
      (record) => record.failureCode === "knowledge_effect_undone_repeatedly",
    );
    expect(undone).toHaveLength(1);
    // The event contract needs a dependency for attention; it is bound to the current bytes.
    expect(undone[0]).toMatchObject({
      state: "attention_required",
      nextObligationId: null,
      dependencyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(records.at(-1)).toBe(undone[0]);
    // Three rewinds restarted assessment; the fourth undo stopped the obligation.
    expect(f.calls.filter((stage) => stage === "assessment")).toHaveLength(4);
    const settled = records.length;
    f.revert();
    await f.cycle(3);
    await f.cycle(3);
    expect(stageRecords(f)).toHaveLength(settled);
  } finally {
    f.events.close();
  }
});
