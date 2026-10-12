import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function worker(root, arm, warm, protocol) {
  const { prepareRepositoryQualityContext } =
    await import("../../../packages/repository-context/dist/index.js");
  const bytes = await readFile(resolve(root, "README.md"));
  const input = {
    repositoryRoot: root,
    origin: "terminal",
    task: {
      intent: "cancellation",
      continuation: "",
      targetPaths: ["src/a.ts"],
      artifactKinds: ["source"],
      requestedActions: ["repository.read"],
      conversationLocale: "ko",
      publicationLocale: "en",
      retrievalLanguages: ["en"],
    },
    instructionMaximumBytes: 4096,
    evidenceMaximumBytes: 4096,
    retrieval: "completed",
    candidates: [{ path: "README.md", contentHash: hash(bytes) }],
    sourceSnapshotId: "snapshot_performance_fixture",
    retrievalBuildId: "lexical_fixture_v1",
    recordObservation: arm === "candidate",
  };
  if (arm === "probe") {
    const { inspectEventWriterCoordinate } =
      await import("../../../packages/project/dist/index.js");
    const started = performance.now();
    const prepared = await prepareRepositoryQualityContext(input);
    const preparationMs = performance.now() - started;
    const cloneStarted = performance.now();
    structuredClone({ result: prepared.result, bindings: prepared.observationBindings });
    const reportCloneMs = performance.now() - cloneStarted;
    const coordinateStarted = performance.now();
    const coordinate = await inspectEventWriterCoordinate(root);
    return {
      preparationMs,
      reportCloneMs,
      writerCoordinateMs: performance.now() - coordinateStarted,
      selectedWriter: coordinate.coordinate.selectedEventSchemaVersion,
    };
  }
  const warmups = [];
  const samples = [];
  for (
    let i = 0;
    i < (warm ? protocol.warmupCallsPerWarmProcess + protocol.measuredCallsPerWarmProcess : 1);
    i++
  ) {
    const cpu = process.cpuUsage();
    const start = performance.now();
    const result = await prepareRepositoryQualityContext(input);
    const elapsedMs = performance.now() - start;
    const usage = process.cpuUsage(cpu);
    const observation = {
      elapsedMs,
      cpuMs: (usage.user + usage.system) / 1000,
      status: result.result.status,
      planDigest: result.result.plan?.planDigest ?? null,
      preparedBytes: result.result.plan?.coverage.preparedByteCount ?? null,
      recording: result.recording?.status ?? null,
      memory: process.memoryUsage(),
    };
    if (warm && i < protocol.warmupCallsPerWarmProcess) warmups.push(observation);
    else samples.push(observation);
  }
  return { warmups, samples, resourceUsage: process.resourceUsage() };
}
