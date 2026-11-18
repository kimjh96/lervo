import { utimes } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkforceAssignment } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { retryConvergenceAssignment } from "../src/assignment-failure.js";
import { planProjectConvergenceArtifactRetention } from "../src/cas-retention-plan.js";
import { readConvergenceAssignmentResult } from "../src/convergence-stage-artifact.js";
import { finishRetention, oldDate, retentionFixture } from "./cas-retention-fixture.js";

type Fixture = Awaited<ReturnType<typeof retentionFixture>>;

const fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function fixture() {
  const f = await retentionFixture();
  fixtures.push(f);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  return f;
}

const lease = sha256("lease generation");

/** The fields `withConvergenceAssignment` stores; key order follows `canonicalJson`. */
function stageResult(f: Fixture, assignmentId: string, obligationId: string, named = "") {
  return f.put({
    assignmentId,
    dependencyHash: null,
    failureCode: null,
    input: { obligationId, stageData: { named } },
    leaseGeneration: lease,
    nextStage: null,
    state: "current",
  });
}

function failure(f: Fixture, assignmentId: string, input: string) {
  return f.put({
    assignmentHash: sha256(assignmentId),
    assignmentId,
    code: "knowledge_job_transient_failure",
    input: { obligationId: "private" },
    inputArtifactHash: input,
    kind: "convergence_assignment_failure",
    schemaVersion: 1,
  });
}

function observation(f: Fixture, assignmentId: string, input: string) {
  return f.put({
    admissionObservationHash: sha256(`admission ${assignmentId} ${input}`),
    assignmentId,
    contextSkips: [],
    inputArtifactHash: input,
    kind: "provider_stage_observation",
    schemaVersion: 1,
    task: "review",
    usage: {},
    value: {},
  });
}

/** Bytes outside `put`'s JSON encoding, aged past grace like every other fixture object. */
async function raw(f: Fixture, text: string) {
  const artifact = await f.artifacts.put(text);
  const hash = artifact.contentHash.slice(7);
  await utimes(
    resolve(f.storage.paths.cas, "sha256", hash.slice(0, 2), hash.slice(2)),
    oldDate,
    oldDate,
  );
  return artifact;
}

async function assignment(f: Fixture, id: string, obligationId: string) {
  const input = await f.put({ input: id });
  f.event("assignment.created", {
    assignmentId: id,
    convergenceObligationId: obligationId,
    convergenceInputArtifactHash: input.contentHash,
  });
  return input.contentHash;
}

function completed(f: Fixture, id: string, artifacts: string[], status = "completed") {
  f.event("assignment.completed", { assignmentId: id, status, artifactHashes: artifacts });
}

/** One settled obligation: `asn_<label>_old` settles an earlier stage, `asn_<label>_latest` the last. */
async function settledObligation(f: Fixture, label: string) {
  const obligationId = `kconv_${label}`;
  const old = `asn_${label}_old`;
  const latest = `asn_${label}_latest`;
  f.event("repository.knowledge.baseline.requested", { obligationId });
  const oldInput = await assignment(f, old, obligationId);
  const detail = await f.put({ detail: label });
  f.event("repository.knowledge.stage.recorded", {
    obligationId,
    stage: "assessment",
    state: "current",
    assignmentId: old,
    resultArtifactHash: detail.contentHash,
  });
  const latestInput = await assignment(f, latest, obligationId);
  const settle = () => {
    f.event("repository.knowledge.stage.recorded", {
      obligationId,
      stage: "lifecycle_verification",
      state: "current",
      assignmentId: latest,
      inputArtifactHash: latestInput,
    });
    f.event("repository.knowledge.convergence.recorded", {
      obligationId,
      terminalState: "current",
    });
  };
  return { obligationId, old, latest, oldInput, latestInput, detail, settle };
}

it("collects a superseded stage result and keeps the latest settled and open stages' results", async () => {
  const f = await fixture();
  const settled = await settledObligation(f, "stage");
  const oldResult = await stageResult(
    f,
    settled.old,
    settled.obligationId,
    settled.detail.contentHash,
  );
  completed(f, settled.old, [oldResult.contentHash]);
  const latestResult = await stageResult(f, settled.latest, settled.obligationId);
  completed(f, settled.latest, [latestResult.contentHash]);
  settled.settle();
  f.event("repository.knowledge.baseline.requested", { obligationId: "kconv_open" });
  await assignment(f, "asn_open", "kconv_open");
  const openResult = await stageResult(f, "asn_open", "kconv_open");
  completed(f, "asn_open", [openResult.contentHash]);
  f.event("repository.knowledge.stage.recorded", {
    obligationId: "kconv_open",
    stage: "assessment",
    state: "current",
    assignmentId: "asn_open",
  });

  const plan = await planProjectConvergenceArtifactRetention(f.storage, new Date("2026-11-18"));
  expect(plan.collectable).toMatchObject({
    objects: 2,
    bytes: oldResult.byteCount + settled.detail.byteCount,
    byReason: {
      // The superseded result itself, then the stage output that only it still named.
      stage_result_superseded: {
        objects: 2,
        bytes: oldResult.byteCount + settled.detail.byteCount,
      },
      failure_superseded: { objects: 0 },
      observation_superseded: { objects: 0 },
      unreferenced: { objects: 0 },
    },
  });
  expect(JSON.stringify(plan)).not.toContain(oldResult.contentHash.slice(7));
  expect(await f.artifacts.has(oldResult.uri)).toBe(true);

  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 2,
  });
  expect(await f.artifacts.has(oldResult.uri)).toBe(false);
  expect(await f.artifacts.has(settled.detail.uri)).toBe(false);
  for (const artifact of [latestResult, openResult])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);

  // Readers report the pruned record instead of an integrity failure.
  expect(await readConvergenceAssignmentResult(f.artifacts, oldResult.contentHash)).toEqual({
    state: "result_unavailable",
  });
  expect(
    await readConvergenceAssignmentResult(f.artifacts, latestResult.contentHash),
  ).toMatchObject({ state: "available", value: { assignmentId: settled.latest } });
});

it("collects superseded failure and observation records under the same rule", async () => {
  const f = await fixture();
  const settled = await settledObligation(f, "records");
  const oldFailure = await failure(f, settled.old, settled.oldInput);
  completed(f, settled.old, [oldFailure.contentHash], "failed");
  const oldObservation = await observation(f, settled.old, settled.oldInput);
  // An observation of another input is not provably this stage's record.
  const foreignObservation = await observation(f, settled.old, sha256("another input"));
  const latestFailure = await failure(f, settled.latest, settled.latestInput);
  completed(f, settled.latest, [latestFailure.contentHash], "failed");
  const latestObservation = await observation(f, settled.latest, settled.latestInput);
  settled.settle();

  const plan = await planProjectConvergenceArtifactRetention(f.storage, new Date("2026-11-18"));
  expect(plan.collectable.byReason).toMatchObject({
    failure_superseded: { objects: 1, bytes: oldFailure.byteCount },
    observation_superseded: { objects: 1, bytes: oldObservation.byteCount },
    stage_result_superseded: { objects: 0 },
    // ADR-0534 already released the earlier stage's output, which no record names.
    unreferenced: { objects: 1, bytes: settled.detail.byteCount },
  });

  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 3,
  });
  for (const artifact of [oldFailure, oldObservation, settled.detail])
    expect(await f.artifacts.has(artifact.uri)).toBe(false);
  for (const artifact of [foreignObservation, latestFailure, latestObservation])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);
});

it("keeps every object whose shape is unknown, unparseable or ambiguous", async () => {
  const f = await fixture();
  const settled = await settledObligation(f, "shapes");
  const twin = "asn_shapes_twin";
  await assignment(f, twin, settled.obligationId);
  const control = await stageResult(f, settled.old, settled.obligationId);
  const unparseable = await raw(f, '{"assignmentId":"asn_shapes_old","input":');
  const unknown = await f.put({ assignmentId: settled.old, note: "no stage fields" });
  const otherAssignment = await stageResult(f, "asn_unrelated", settled.obligationId);
  const otherObligation = await stageResult(f, settled.old, "kconv_elsewhere");
  const ambiguous = await stageResult(f, twin, settled.obligationId, "twin");
  const availability = await f.put({
    admissionObservationHash: sha256("probe"),
    assignmentId: settled.old,
    inputArtifactHash: settled.oldInput,
    kind: "native_provider_availability",
    schemaVersion: 1,
  });
  completed(f, settled.old, [
    control.contentHash,
    unparseable.contentHash,
    unknown.contentHash,
    otherAssignment.contentHash,
    otherObligation.contentHash,
    ambiguous.contentHash,
  ]);
  completed(f, twin, [ambiguous.contentHash]);
  settled.settle();

  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 2,
  });
  expect(await f.artifacts.has(control.uri)).toBe(false);
  expect(await f.artifacts.has(settled.detail.uri)).toBe(false);
  for (const artifact of [
    unparseable,
    unknown,
    otherAssignment,
    otherObligation,
    ambiguous,
    availability,
  ])
    expect(await f.artifacts.has(artifact.uri)).toBe(true);
});

it("stops a retry as uncertain when its failure proof was pruned", async () => {
  const pruned = sha256("pruned failure proof");
  const get = vi.fn(async () => {
    throw Object.assign(new Error("absent"), { code: "not_found" });
  });
  const storage = { artifacts: { get }, events: { list: () => [] } } as unknown as ProjectStorage;
  const assignment = {
    assignmentId: "asn_0123456789abcdef01234567",
    status: "failed",
    lease: null,
    convergence: { obligationId: "kconv_0123456789abcdef01234567" },
    resultArtifacts: [{ artifactId: "art_0123456789", contentHash: pruned }],
  } as unknown as WorkforceAssignment;
  await expect(retryConvergenceAssignment(storage, assignment)).rejects.toMatchObject({
    code: "knowledge_effect_uncertain",
  });
  expect(get).toHaveBeenCalledWith(`lervo-cas://sha256/${pruned.slice(7)}`);
});
