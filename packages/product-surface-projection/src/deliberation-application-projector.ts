import type {
  DeliberationPolicy,
  EventEnvelope,
  ProductDeliberationViewV1,
  VerificationSuite,
} from "@lervo/schemas";

import {
  projectDeliberationView,
  type ProductDeliberationParticipantBindingV1,
  type ProductDeliberationProjectionInputV1,
} from "./deliberation-projector.js";
import { readDeliberationArtifactEvents } from "./deliberation-artifact-event-reader.js";
import { readDeliberationOutcomeEvent } from "./deliberation-outcome-event-reader.js";
import { readDeliberationVerificationEvents } from "./deliberation-verification-event-reader.js";

export interface ProductDeliberationApplicationProjectionInputV1 {
  deliberationId: string;
  projectId: string;
  status: ProductDeliberationProjectionInputV1["status"];
  policy: DeliberationPolicy;
  origin: ProductDeliberationProjectionInputV1["origin"];
  events: readonly EventEnvelope[];
  readArtifact(uri: string): Promise<Uint8Array>;
  loadVerificationSuite(suiteId: string): Promise<VerificationSuite>;
  participantBindings?: readonly ProductDeliberationParticipantBindingV1[];
  sourceEventHeadHash: string;
  repositoryRevision: string;
  resourceReportCoordinate: string | null;
  publicationCoordinate: string | null;
  originDeliveryCoordinate: string | null;
}

export async function projectDeliberationApplicationView(
  input: ProductDeliberationApplicationProjectionInputV1,
): Promise<ProductDeliberationViewV1> {
  const artifactSource = readDeliberationArtifactEvents({
    deliberationId: input.deliberationId,
    events: input.events,
  });
  const artifacts = artifactSource.status === "complete" ? artifactSource.artifacts : [];
  const verificationSource =
    artifactSource.status === "complete"
      ? await readDeliberationVerificationEvents({
          artifacts,
          events: input.events,
          readArtifact: input.readArtifact,
          loadSuite: input.loadVerificationSuite,
        })
      : null;
  const verificationEvidence =
    verificationSource?.status === "complete" ? verificationSource.evidence : [];
  const terminal = ["converged", "no_consensus", "failed"].includes(input.status);
  const outcomeSource =
    artifactSource.status === "complete" && verificationSource?.status === "complete"
      ? readDeliberationOutcomeEvent({
          deliberationId: input.deliberationId,
          policy: input.policy,
          artifacts,
          verificationEvidence,
          events: input.events,
        })
      : null;
  const outcome =
    outcomeSource?.status === "complete" && outcomeSource.outcome.status === input.status
      ? outcomeSource.outcome
      : null;
  const outcomeSourceStatus: ProductDeliberationProjectionInputV1["outcomeSourceStatus"] =
    outcomeSource === null
      ? terminal
        ? "unavailable"
        : "active"
      : outcomeSource.status === "invalid" ||
          (outcomeSource.status === "complete" && outcomeSource.outcome.status !== input.status) ||
          (outcomeSource.status === "active" && terminal)
        ? "invalid"
        : outcomeSource.status;

  return projectDeliberationView({
    deliberationId: input.deliberationId,
    projectId: input.projectId,
    policy: input.policy,
    artifacts,
    artifactSourceStatus: artifactSource.status,
    verificationEvidence,
    verificationSourceStatus:
      verificationSource?.status ??
      (artifactSource.status === "invalid" ? "invalid" : "unavailable"),
    status: input.status,
    outcome,
    outcomeSourceStatus,
    origin: input.origin,
    ...(input.participantBindings === undefined
      ? {}
      : { participantBindings: input.participantBindings }),
    sourceEventHeadHash: input.sourceEventHeadHash,
    repositoryRevision: input.repositoryRevision,
    resourceReportCoordinate: input.resourceReportCoordinate,
    publicationCoordinate: input.publicationCoordinate,
    originDeliveryCoordinate: input.originDeliveryCoordinate,
  });
}
