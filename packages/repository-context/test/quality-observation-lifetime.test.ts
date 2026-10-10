import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import * as recording from "../src/context-quality-recording.js";
import {
  prepareRepositoryQualityContext,
  withRepositoryQualityObservation,
  type RepositoryQualityInput,
} from "../src/repository-quality-context.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const receipt = {
  status: "recorded",
  eventId: "evt_observation",
  artifactHash: `sha256:${"a".repeat(64)}`,
} satisfies recording.ContextQualityRecording;
async function fixture(): Promise<RepositoryQualityInput> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-lifetime-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_lifetime" }));
  return {
    repositoryRoot: root,
    origin: "terminal",
    recordObservation: true,
    task: {
      intent: "Read current state",
      continuation: "",
      targetPaths: [],
      artifactKinds: [],
      requestedActions: ["repository.read"],
      conversationLocale: "ko",
      publicationLocale: "en",
      retrievalLanguages: ["en"],
    },
    instructionMaximumBytes: 4096,
    evidenceMaximumBytes: 0,
    retrieval: "not_run",
    candidates: [],
    sourceSnapshotId: "snapshot_lifetime",
    retrievalBuildId: "fixture_v1",
  };
}
it("runs observation while recording is pending and isolates its mutable view", async () => {
  const input = await fixture(),
    gate = deferred<recording.ContextQualityRecording>(),
    read = deferred<void>();
  const write = vi
    .spyOn(recording, "recordContextQualityPreparation")
    .mockReturnValue(gate.promise);
  let completed = false,
    originalId = "";
  const pending = withRepositoryQualityObservation(input, async (prepared) => {
    expect(write).toHaveBeenCalledOnce();
    expect(prepared).not.toHaveProperty("recording");
    originalId = prepared.result.requestId;
    prepared.result.requestId = "mutated_read_view";
    read.resolve();
    return "observed";
  }).then((result) => {
    completed = true;
    return result;
  });
  await read.promise;
  await Promise.resolve();
  expect(completed).toBe(false);
  gate.resolve(receipt);
  const result = await pending;
  expect(result.value).toBe("observed");
  expect(result.preparation.recording).toEqual(receipt);
  expect(result.preparation.result.requestId).toBe(originalId);
  expect(write.mock.calls[0]![0].result.requestId).toBe(originalId);
});
it("drains recording before propagating an observation failure", async () => {
  const input = await fixture(),
    gate = deferred<recording.ContextQualityRecording>(),
    started = deferred<void>();
  vi.spyOn(recording, "recordContextQualityPreparation").mockReturnValue(gate.promise);
  const failure = new Error("read failed");
  let completed = false;
  const pending = withRepositoryQualityObservation(input, async () => {
    started.resolve();
    throw failure;
  }).catch((error) => {
    completed = true;
    return error;
  });
  await started.promise;
  await Promise.resolve();
  expect(completed).toBe(false);
  gate.resolve({ status: "unavailable" });
  expect(await pending).toBe(failure);
});
it("drains an observation after recording fails", async () => {
  const input = await fixture(),
    gate = deferred<void>(),
    started = deferred<void>();
  const failure = new Error("recording failed");
  vi.spyOn(recording, "recordContextQualityPreparation").mockRejectedValue(failure);
  let completed = false;
  const pending = withRepositoryQualityObservation(input, async () => {
    started.resolve();
    await gate.promise;
    return "read";
  }).catch((error) => {
    completed = true;
    return error;
  });
  await started.promise;
  await Promise.resolve();
  expect(completed).toBe(false);
  gate.resolve();
  expect(await pending).toBe(failure);
});
it("retains both failures after both operations settle", async () => {
  const input = await fixture(),
    readFailure = new Error("read"),
    writeFailure = new Error("write");
  vi.spyOn(recording, "recordContextQualityPreparation").mockRejectedValue(writeFailure);
  const error = await withRepositoryQualityObservation(input, async () => {
    throw readFailure;
  }).catch((error) => error as AggregateError);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error).toMatchObject({ errors: [readFailure, writeFailure] });
});
it("keeps disabled recording inert and preserves an unavailable receipt", async () => {
  const input = await fixture();
  const write = vi
    .spyOn(recording, "recordContextQualityPreparation")
    .mockResolvedValue({ status: "unavailable" });
  const disabled = await withRepositoryQualityObservation(
    { ...input, recordObservation: false },
    async () => "read",
  );
  expect(disabled.preparation.recording).toBeNull();
  expect(write).not.toHaveBeenCalled();
  const unavailable = await withRepositoryQualityObservation(input, async () => "read");
  expect(unavailable.preparation.recording).toEqual({ status: "unavailable" });
});
it("retains the original awaited API and snapshots recording coordinates before preparation", async () => {
  const input = await fixture(),
    gate = deferred<recording.ContextQualityRecording>(),
    started = deferred<void>();
  input.recordingCoordinates = { runId: "run_original", sessionId: "ses_original" };
  const write = vi.spyOn(recording, "recordContextQualityPreparation").mockImplementation(() => {
    started.resolve();
    return gate.promise;
  });
  let completed = false;
  const pending = prepareRepositoryQualityContext(input).then((result) => {
    completed = true;
    return result;
  });
  input.recordingCoordinates.runId = "run_changed";
  await started.promise;
  expect(completed).toBe(false);
  expect(write.mock.calls[0]![0].coordinates).toEqual({
    runId: "run_original",
    sessionId: "ses_original",
  });
  gate.resolve(receipt);
  expect((await pending).recording).toEqual(receipt);
});
