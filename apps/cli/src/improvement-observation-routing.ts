import type {
  ImprovementEffectComparisonPlanV1,
  ImprovementEffectObservationRequestV1,
  ImprovementEvaluationProtocolRequestV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import type { DevelopmentPatternCandidate } from "@lervo/repository-knowledge";
import { createImprovementEffectComparisonPlan } from "@lervo/work-controller";

import {
  allPatternEvents,
  patternArtifactId,
  patternArtifactJson,
  projectPatterns,
} from "./development-pattern-storage.js";
import {
  currentImprovementTargetHash,
  exactImprovementDescriptor,
  findImprovementEvent,
  putImprovementJsonArtifact,
} from "./improvement-effect-routing-shared.js";
import {
  allImprovementEffectEvents,
  appendImprovementEffectEvent,
  writeImprovementEffectProjection,
} from "./improvement-effect-storage.js";

export interface ImprovementEffectRouteResult {
  plan: ImprovementEffectComparisonPlanV1;
  observationEventId: string | null;
}

export async function routeImprovementEffect(input: {
  repositoryRoot: string;
  request: ImprovementEffectObservationRequestV1;
  applyPlanId?: string;
  observer?: ImprovementObservationPortV1;
}): Promise<ImprovementEffectRouteResult> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const effectEvents = allImprovementEffectEvents(storage);
    const registration = findImprovementEvent(
      effectEvents,
      "development.pattern.evaluation.registered",
      "protocolId",
      input.request.protocolId,
    );
    if (registration === undefined)
      throw new Error("The registered evaluation protocol was not found.");
    const artifactHash = registration.payload.protocolArtifactHash;
    if (typeof artifactHash !== "string")
      throw new Error("The protocol artifact binding is invalid.");
    const protocol = await patternArtifactJson<ImprovementEvaluationProtocolRequestV1>(
      storage,
      artifactHash,
    );
    const patternEvents = allPatternEvents(storage);
    const promotion = patternEvents.find(
      (event) =>
        event.type === "development.pattern.transitioned" &&
        event.payload.patternId === protocol.patternId &&
        event.payload.toState === "promoted" &&
        Date.parse(event.occurredAt) >= Date.parse(protocol.registeredAt),
    );
    if (promotion === undefined)
      throw new Error("A post-registration pattern promotion was not found.");
    const pattern = projectPatterns(patternEvents).find(
      (item) => item.patternId === protocol.patternId,
    );
    if (pattern?.candidateContentHash === null || pattern?.candidateContentHash === undefined)
      throw new Error("The promoted pattern candidate was not found.");
    const candidate = await patternArtifactJson<DevelopmentPatternCandidate>(
      storage,
      pattern.candidateContentHash,
    );
    const source = {
      projectId: storage.manifest.projectId,
      protocol,
      protocolPlanId: String(registration.payload.protocolPlanId),
      registrationEventId: registration.eventId,
      registeredAt: registration.occurredAt,
      promotionEventId: promotion.eventId,
      promotedAt: promotion.occurredAt,
      currentPatternState: pattern.state,
      currentTargetContentHash: await currentImprovementTargetHash(input.repositoryRoot, candidate),
    };
    const inspectedPlan = createImprovementEffectComparisonPlan({ request: input.request, source });
    if (input.applyPlanId === undefined) return { plan: inspectedPlan, observationEventId: null };
    if (input.applyPlanId !== inspectedPlan.planId)
      throw new Error("The improvement-effect comparison plan is stale.");
    if (inspectedPlan.status !== "ready")
      throw new Error(
        `The improvement-effect observation is blocked: ${inspectedPlan.blockedReasons.join(", ")}.`,
      );
    if (input.observer === undefined)
      throw new Error("No improvement observation adapter is configured for verification.");
    const descriptor = await input.observer.inspect(input.request.adapter.adapterId);
    if (!exactImprovementDescriptor(input.request.adapter, descriptor))
      throw new Error("The improvement observation adapter differs from the reviewed plan.");
    const freshRequest = {
      ...input.request,
      adapter: descriptor,
      treatment: await input.observer.verify({
        phase: "treatment",
        patternId: input.request.patternId,
        window: input.request.treatmentWindow,
        observations: input.request.treatment,
      }),
    };
    const freshPlan = createImprovementEffectComparisonPlan({ request: freshRequest, source });
    if (freshPlan.planId !== input.applyPlanId)
      throw new Error("Verified treatment evidence differs from the reviewed comparison plan.");
    const existing = findImprovementEvent(
      effectEvents,
      "development.pattern.effect.observed",
      "comparisonId",
      freshPlan.comparisonId,
    );
    if (existing !== undefined) {
      if (existing.payload.comparisonPlanId !== freshPlan.planId)
        throw new Error("The comparison identity conflicts with existing canonical evidence.");
      await writeImprovementEffectProjection(input.repositoryRoot, effectEvents);
      return { plan: freshPlan, observationEventId: existing.eventId };
    }
    const artifact = await putImprovementJsonArtifact(storage, {
      request: freshRequest,
      comparison: freshPlan,
    });
    const event = appendImprovementEffectEvent(storage, {
      type: "development.pattern.effect.observed",
      occurredAt: freshPlan.observedAt,
      payload: {
        comparisonId: freshPlan.comparisonId,
        patternId: freshPlan.patternId,
        protocolId: freshPlan.protocolId,
        comparisonPlanId: freshPlan.planId,
        comparisonArtifactId: patternArtifactId(artifact.contentHash),
        comparisonArtifactHash: artifact.contentHash,
        registrationEventId: freshPlan.registrationEventId,
        promotionEventId: freshPlan.promotionEventId,
        targetContentHash: freshPlan.targetContentHash,
        adapterId: freshPlan.adapterId,
        adapterVersion: freshPlan.adapterVersion,
        adapterDescriptorHash: freshPlan.adapterDescriptorHash,
        treatmentWindowHash: freshPlan.treatmentWindowHash,
        treatmentObservationHash: freshPlan.treatmentObservationHash,
        overall: freshPlan.overall,
        attribution: freshPlan.attribution,
        rollbackDisposition: freshPlan.rollbackDisposition,
        metricCount: freshPlan.comparisons.length,
        observedAt: freshPlan.observedAt,
      },
    });
    await writeImprovementEffectProjection(input.repositoryRoot, [...effectEvents, event]);
    return { plan: freshPlan, observationEventId: event.eventId };
  } finally {
    await storage.close();
  }
}
