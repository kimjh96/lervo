import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixtureText, stateBytes } from "./context-quality-active-fixture.mjs";
import { observeDurableCommits } from "./context-quality-durable-commits.mjs";

import { digest } from "./context-quality-artifact-identity.mjs";

// Numeric samples are column encoded to preserve every measurement within the canonical JSON source-unit bound.
export const sampleColumns = [
  "elapsedMs",
  "cpuMs",
  "rss",
  "heapUsed",
  "external",
  "arrayBuffers",
  "preparedBytes",
  "sourceGeneration",
  "requestCount",
  "signature",
];
export async function activeWorker(root, arm, workload, profile, protocol) {
  // Allowance-bearing protocols must count the strong commits each arm actually performs.
  const commits =
    protocol.gates?.durableCommitAllowanceMs === undefined ? null : observeDurableCommits();
  try {
    return await measure(root, arm, workload, profile, protocol, commits);
  } finally {
    commits?.restore();
  }
}

async function measure(root, arm, workload, profile, protocol, commits) {
  if (protocol.execution !== undefined && protocol.execution.kind !== "packed_cli")
    throw new Error("Unsupported execution artifact; no source fallback.");
  const runtime =
    protocol.execution?.kind === "packed_cli"
      ? await import(
          pathToFileURL(resolve(protocol.execution.packageRoot, "dist/repository-runtime.js")).href
        )
      : null;
  const {
    prepareRepositoryQualityContext,
    withRepositoryQualityObservation,
    verifyRepositoryContextOutcome,
    recordContextQualityVerification,
  } = runtime ?? (await import("../../../packages/repository-context/dist/index.js"));
  const { canonicalHash } = runtime ?? (await import("../../../packages/search/dist/index.js"));
  const { openProjectStorage } =
    runtime ?? (await import("../../../packages/project-storage/dist/index.js"));
  const { inspectEventWriterCoordinate } =
    runtime ?? (await import("../../../packages/project/dist/index.js"));
  if ((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion !== 6)
    throw new Error("Inactive fixture writer.");
  const record = arm === "candidate";
  const warm = workload !== "cold";
  const warmupCount = warm ? protocol.warmups : 0;
  const count = warmupCount + (warm ? protocol.samples : 1);
  const concurrency = workload === "concurrent" ? protocol.concurrency : 1;
  const samples = [],
    warmups = [];
  const beforeBytes = await stateBytes(root);
  let semanticValid = true;
  for (let i = 0; i < count; i++) {
    const generation = workload === "changed" ? i + 1 : 0;
    const cpu = process.cpuUsage(),
      start = performance.now();
    if (workload === "changed")
      await writeFile(resolve(root, "README.md"), fixtureText(generation));
    const source = await readFile(resolve(root, "README.md"));
    const preparation = {
      repositoryRoot: root,
      origin: "terminal",
      task: {
        intent: "cancellation",
        continuation: "",
        targetPaths: ["result.txt"],
        artifactKinds: ["source"],
        requestedActions: ["repository.read"],
        conversationLocale: "ko",
        publicationLocale: "en",
        retrievalLanguages: ["en"],
      },
      instructionMaximumBytes: profile,
      evidenceMaximumBytes: profile,
      retrieval: "completed",
      candidates: [{ path: "README.md", contentHash: digest(source) }],
      sourceSnapshotId: `snapshot_generation_${generation}`,
      retrievalBuildId: "lexical_fixture_v1",
      recordObservation: record,
    };
    const results = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const observed = await withRepositoryQualityObservation(preparation, async (prepared) => {
          if (!prepared.result.plan || !prepared.observationBindings)
            throw new Error("Fixture preparation unavailable.");
          const plan = prepared.result.plan;
          const observation = await verifyRepositoryContextOutcome({
            preparation,
            artifactPath: "result.txt",
            planDigest: plan.planDigest,
            definition: {
              definitionId: "fixture.result.v1",
              language: "en",
              preserveProtectedMaterial: false,
              task: {
                definitionId: "fixture.task.v1",
                taskDigest: canonicalHash(preparation.task),
                checks: [
                  { checkId: "exact", requirement: "The complete fixture result must equal good." },
                ],
              },
            },
            isPublication: false,
            taskEvaluator: {
              buildId: digest("deterministic fixture evaluator v1"),
              evaluate: async (request) => ({
                planDigest: request.planDigest,
                artifactDigest: request.artifactDigest,
                definitionHash: request.definitionHash,
                checks: [
                  { checkId: "exact", status: request.content === "good" ? "passed" : "failed" },
                ],
              }),
            },
          });
          const verificationRecording = record
            ? await recordContextQualityVerification({
                repositoryRoot: root,
                requestId: prepared.result.requestId,
                projectId: prepared.observationBindings.projectId,
                policySetDigest: prepared.observationBindings.policySetDigest,
                observation,
              })
            : null;
          const readValid =
            prepared.instructions?.report.status === "complete" &&
            prepared.passages.length === 1 &&
            prepared.passages[0].contentHash === digest(source) &&
            observation.disposition === "passed" &&
            verificationRecording?.status === (record ? "recorded" : undefined);
          return {
            readValid,
            bytes: plan.coverage.preparedByteCount,
            signature: digest(
              JSON.stringify({
                planDigest: plan.planDigest,
                status: prepared.result.status,
                coverage: plan.coverage,
                passages: prepared.passages,
                disposition: observation.disposition,
                artifactDigest: observation.artifactDigest,
              }),
            ),
          };
        });
        semanticValid &&=
          observed.value.readValid &&
          observed.preparation.recording?.status === (record ? "recorded" : undefined);
        return observed.value;
      }),
    );
    const elapsedMs = performance.now() - start,
      usage = process.cpuUsage(cpu),
      memory = process.memoryUsage();
    semanticValid &&= new Set(results.map((r) => r.signature)).size === 1;
    const row = [
      elapsedMs,
      (usage.user + usage.system) / 1000,
      memory.rss,
      memory.heapUsed,
      memory.external,
      memory.arrayBuffers,
      results[0].bytes,
      generation,
      concurrency,
      results[0].signature,
    ];
    (i < warmupCount ? warmups : samples).push(row);
  }
  // The same path and mtime-independent current bytes must reject an older selected hash.
  let staleSourceRejected = true;
  if (workload === "changed") {
    const prior = digest(await readFile(resolve(root, "README.md")));
    await writeFile(resolve(root, "README.md"), fixtureText(count + 1));
    const stale = await prepareRepositoryQualityContext({
      repositoryRoot: root,
      origin: "terminal",
      task: {
        intent: "cancellation",
        continuation: "",
        targetPaths: ["result.txt"],
        artifactKinds: [],
        requestedActions: [],
        conversationLocale: null,
        publicationLocale: null,
        retrievalLanguages: [],
      },
      instructionMaximumBytes: profile,
      evidenceMaximumBytes: profile,
      retrieval: "completed",
      candidates: [{ path: "README.md", contentHash: prior }],
      sourceSnapshotId: "snapshot_stale_probe",
      retrievalBuildId: "lexical_fixture_v1",
      recordObservation: false,
    });
    staleSourceRejected =
      stale.passages.length === 0 && !["ready", "no_evidence"].includes(stale.result.status);
  }
  const storage = await openProjectStorage(root);
  let eventCount, integrity;
  try {
    eventCount = storage.events.list({
      types: ["context.quality.prepared", "context.quality.verified"],
      limit: 1000,
    }).length;
    integrity = storage.events.verifyIntegrity().valid;
  } finally {
    await storage.close();
  }
  return {
    samples,
    warmups,
    semanticValid,
    staleSourceRejected,
    eventCount,
    integrity,
    expectedEventCount: record ? count * concurrency * 2 : 0,
    stateGrowthBytes: (await stateBytes(root)) - beforeBytes,
    resourceUsage: process.resourceUsage(),
    ...(commits ? { durableCommits: commits.count() } : {}),
  };
}
