import { createHash } from "node:crypto";

import { documentIdForPath } from "@lervo/context";
import {
  createTurnMeasurement,
  recordTurnMeasurement,
  type TurnUsageObservation,
} from "@lervo/execution-contract";
import type { ProviderJsonUsage } from "@lervo/repository-knowledge-compiler";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { SemanticReviewContextDocument } from "./review-context.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

const nativeCounterSemantics = {
  codex: "codex.exec-json.turn-completed.usage",
  claude: "claude.json.result.model-usage",
} as const;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * ADR-0459 measurement for one knowledge-worker provider call: the review context Lervo loaded
 * from `loadCanonicalReviewContext` and the provider-reported usage already kept in the stage
 * observation artifact, attributed to the worker agent and its stage.
 */
export async function recordKnowledgeWorkerMeasurement(input: {
  context: ConvergenceRuntimeContext;
  agentId: string;
  task: string;
  snapshotHash: string;
  observationArtifactHash: string;
  admissionObservationHash: string;
  usage: ProviderJsonUsage;
  contextDocuments: readonly SemanticReviewContextDocument[];
  occurredAt: string;
}): Promise<void> {
  const turn = digest(`lervo.knowledge-worker.turn.v1\0${input.observationArtifactHash}`);
  const usage: TurnUsageObservation = {
    status: "observed",
    source: "provider_reported",
    usage: input.usage,
  };
  try {
    const measurement = createTurnMeasurement({
      coordinates: {
        projectId: input.context.storage.manifest.projectId,
        runId: `run_knowledge_${turn.slice(0, 24)}`,
        sessionId: `ses_knowledge_${turn.slice(0, 24)}`,
      },
      attribution: {
        agentId: input.agentId,
        conversationDigest: null,
        channel: "knowledge_worker",
        turnEventId: `kwt_${turn.slice(0, 24)}`,
        stage: input.task,
      },
      source: {
        provider: input.context.provider,
        adapterId: `${input.context.provider}/knowledge-worker`,
        adapterVersion: "1",
        nativeCounterSemanticsId: nativeCounterSemantics[input.context.provider],
        requestedModel: null,
        providerSessionId: input.admissionObservationHash,
      },
      usage,
      context: {
        sourceRevision: input.snapshotHash,
        documents: input.contextDocuments.map((document) => ({
          documentId: documentIdForPath(document.path),
          contentHash: document.contentHash,
          byteCount: Buffer.byteLength(document.content, "utf8"),
          ruleId: `knowledge_worker.${document.role}`,
        })),
      },
      occurredAt: input.occurredAt,
    });
    await recordTurnMeasurement(input.context.storage, measurement);
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("measurement_unavailable", { cause: error });
  }
}
