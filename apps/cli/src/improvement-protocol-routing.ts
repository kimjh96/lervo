import type {
  ImprovementEvaluationProtocolPlanV1,
  ImprovementEvaluationProtocolRequestV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  sha256,
  type DevelopmentPatternCandidate,
  type DevelopmentPatternReview,
} from "@lervo/repository-knowledge";
import { createImprovementEvaluationProtocolPlan } from "@lervo/work-controller";

import {
  allPatternEvents,
  patternArtifactId,
  patternArtifactJson,
  projectPatterns,
} from "./development-pattern-storage.js";
import {
  exactImprovementDescriptor,
  findImprovementEvent,
  putImprovementJsonArtifact,
} from "./improvement-effect-routing-shared.js";
import {
  allImprovementEffectEvents,
  appendImprovementEffectEvent,
  writeImprovementEffectProjection,
} from "./improvement-effect-storage.js";

export interface ImprovementProtocolRouteResult {
  plan: ImprovementEvaluationProtocolPlanV1;
  registrationEventId: string | null;
}

export async function routeImprovementProtocol(input: {
  repositoryRoot: string;
  request: ImprovementEvaluationProtocolRequestV1;
  applyPlanId?: string;
  observer?: ImprovementObservationPortV1;
}): Promise<ImprovementProtocolRouteResult> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const pattern = projectPatterns(allPatternEvents(storage)).find(
      (item) => item.patternId === input.request.patternId,
    );
    if (pattern?.candidateContentHash === null || pattern?.candidateContentHash === undefined)
      throw new Error("The improvement protocol pattern candidate was not found.");
    if (pattern.reviewContentHash === null)
      throw new Error("The improvement protocol review was not found.");
    const candidate = await patternArtifactJson<DevelopmentPatternCandidate>(
      storage,
      pattern.candidateContentHash,
    );
    const review = await patternArtifactJson<DevelopmentPatternReview>(
      storage,
      pattern.reviewContentHash,
    );
    if (review.decision !== "accept") throw new Error("The pattern review was not accepted.");
    const source = {
      projectId: storage.manifest.projectId,
      patternId: pattern.patternId,
      patternState: pattern.state,
      candidateContentHash: pattern.candidateContentHash,
      reviewContentHash: pattern.reviewContentHash,
      targetContentHash: sha256(candidate.target.content),
      observedAt: input.request.registeredAt,
    };
    const inspectedPlan = createImprovementEvaluationProtocolPlan({
      request: input.request,
      source,
    });
    if (input.applyPlanId === undefined) return { plan: inspectedPlan, registrationEventId: null };
    if (input.applyPlanId !== inspectedPlan.planId)
      throw new Error("The improvement evaluation protocol plan is stale.");
    if (inspectedPlan.status !== "ready")
      throw new Error(
        `The improvement protocol is blocked: ${inspectedPlan.blockedReasons.join(", ")}.`,
      );
    if (input.observer === undefined)
      throw new Error("No improvement observation adapter is configured for verification.");
    const descriptor = await input.observer.inspect(input.request.adapter.adapterId);
    if (!exactImprovementDescriptor(input.request.adapter, descriptor))
      throw new Error("The improvement observation adapter differs from the reviewed plan.");
    const freshRequest = {
      ...input.request,
      adapter: descriptor,
      baseline: await input.observer.verify({
        phase: "baseline",
        patternId: input.request.patternId,
        window: input.request.baselineWindow,
        observations: input.request.baseline,
      }),
    };
    const freshPlan = createImprovementEvaluationProtocolPlan({ request: freshRequest, source });
    if (freshPlan.planId !== input.applyPlanId)
      throw new Error("Verified baseline evidence differs from the reviewed protocol plan.");
    const existingEvents = allImprovementEffectEvents(storage);
    const existing = findImprovementEvent(
      existingEvents,
      "development.pattern.evaluation.registered",
      "protocolId",
      freshPlan.protocolId,
    );
    if (existing !== undefined) {
      if (existing.payload.protocolPlanId !== freshPlan.planId)
        throw new Error("The protocol identity conflicts with existing canonical evidence.");
      await writeImprovementEffectProjection(input.repositoryRoot, existingEvents);
      return { plan: freshPlan, registrationEventId: existing.eventId };
    }
    const artifact = await putImprovementJsonArtifact(storage, freshRequest);
    const event = appendImprovementEffectEvent(storage, {
      type: "development.pattern.evaluation.registered",
      occurredAt: freshPlan.registeredAt,
      payload: {
        protocolId: freshPlan.protocolId,
        patternId: freshPlan.patternId,
        protocolPlanId: freshPlan.planId,
        protocolArtifactId: patternArtifactId(artifact.contentHash),
        protocolArtifactHash: artifact.contentHash,
        candidateContentHash: freshPlan.candidateContentHash,
        reviewContentHash: freshPlan.reviewContentHash,
        targetContentHash: freshPlan.targetContentHash,
        adapterId: freshPlan.adapterId,
        adapterVersion: freshPlan.adapterVersion,
        adapterDescriptorHash: freshPlan.adapterDescriptorHash,
        baselineWindowHash: freshPlan.baselineWindowHash,
        baselineObservationHash: freshPlan.baselineObservationHash,
        metricIds: freshPlan.metricIds,
        registeredAt: freshPlan.registeredAt,
      },
    });
    await writeImprovementEffectProjection(input.repositoryRoot, [...existingEvents, event]);
    return { plan: freshPlan, registrationEventId: event.eventId };
  } finally {
    await storage.close();
  }
}
