import { createHash } from "node:crypto";
import {
  collectRunEventsBounded,
  type ArtifactStore,
  type EventStore,
} from "@lervo/storage-contract";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import type { readSupervisionResearchEvidence } from "./supervision-research-evidence.js";
import type { observeSupervisionResearchPolicy } from "./supervision-research-policy.js";

/** Adds fresh review measurements without changing the canonical producer evidence used by completion replay. */
export async function readCompletedResearchReviewEvidence(input: {
  evidence: Awaited<ReturnType<typeof readSupervisionResearchEvidence>>;
  artifacts: ArtifactStore;
  events: EventStore;
  researchPolicy: Awaited<ReturnType<typeof observeSupervisionResearchPolicy>> | null;
}) {
  const { evidence, artifacts, events, researchPolicy } = input;
  const starts = collectRunEventsBounded({
    events,
    runId: evidence.producerRunId,
    maximumEvents: 4096,
  }).filter((event) => event.type === "adapter.started");
  if (starts.length !== 1)
    throw new Error("The completed research run has no unique adapter-start evidence.");
  const start = starts[0]!;
  const capturedSourceMeasurements = evidence.inputs.sources.map((source) => {
    const byteCount = Buffer.byteLength(source.text, "utf8");
    const measuredContentHash = `sha256:${createHash("sha256").update(source.text).digest("hex")}`;
    if (
      measuredContentHash !== source.contentHash ||
      byteCount > evidence.inputs.policy.maximumSourceBytes
    )
      throw new Error("The captured research source differs from its hash or byte limit.");
    return {
      sourceId: source.sourceId,
      path: source.path,
      contentHash: source.contentHash,
      measuredContentHash,
      byteCount,
      maximumSourceBytes: evidence.inputs.policy.maximumSourceBytes,
    };
  });
  return {
    ...evidence,
    recordedExecutionBoundary: {
      eventId: start.eventId,
      runId: start.runId,
      adapterId: start.payload.adapterId,
      adapterVersion: start.payload.adapterVersion,
      executionMode: start.payload.executionMode,
      capabilities: start.payload.capabilities,
      providerSessionId: start.payload.providerSessionId,
    },
    verificationReport: await readSupervisionJsonArtifact(artifacts, evidence.reportArtifactHash),
    capturedSourceMeasurements,
    currentSourceContinuity: capturedSourceMeasurements.map((captured) => {
      const currentContentHash =
        researchPolicy?.sources.find((item) => item.path === captured.path)?.contentHash ?? null;
      return {
        sourceId: captured.sourceId,
        path: captured.path,
        capturedContentHash: captured.contentHash,
        currentContentHash,
        matchesCapturedNow: currentContentHash === captured.contentHash,
      };
    }),
  };
}
