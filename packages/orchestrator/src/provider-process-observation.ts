import { createHash } from "node:crypto";

import {
  inspectAdapterProcessObservationBinding,
  type ProviderAdapter,
} from "@lervo/adapter-contract";
import {
  type AdapterProcessObservation,
  type AdapterSession,
  type ProviderProcessObservedEventPayload,
  validateSchema,
} from "@lervo/schemas";

import type { ManagedEventSpec } from "./telemetry.js";
import { ManagedProviderRunError } from "./provider-run-types.js";

export type ManagedProviderProcessObservationPhase = ProviderProcessObservedEventPayload["phase"];

function providerSessionDigest(observation: AdapterProcessObservation): string {
  return `sha256:${createHash("sha256")
    .update("lervo:managed-provider-process-session:v1\0")
    .update(observation.adapterId)
    .update("\0")
    .update(observation.providerSessionId)
    .digest("hex")}`;
}

export function observeManagedProviderProcess(input: {
  adapter: ProviderAdapter;
  session: AdapterSession;
  phase: ManagedProviderProcessObservationPhase;
}): ManagedEventSpec {
  const observation = input.adapter.inspectProcess(input.session);
  const binding = inspectAdapterProcessObservationBinding({
    session: input.session,
    observation,
  });
  if (!binding.passed) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The provider process observation differs from its managed session.",
    );
  }
  const state =
    observation.status === "unobservable"
      ? { status: observation.status, evidence: observation.evidence }
      : { status: observation.status, evidence: observation.evidence };
  const payload: ProviderProcessObservedEventPayload = {
    adapterId: observation.adapterId,
    providerSessionDigest: providerSessionDigest(observation),
    phase: input.phase,
    ...state,
    observedAt: observation.observedAt,
    releasesAgentAuthority: false,
    releasesAssignmentAuthority: false,
    provesWorkProgress: false,
  };
  if (!validateSchema("providerProcessObservedEventPayload", payload).valid) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The provider process observation payload is invalid.",
    );
  }
  return {
    type: "provider.process.observed",
    schemaVersion: 2,
    occurredAt: observation.observedAt,
    actor: { kind: "provider", provider: input.session.provider },
    payload,
  };
}
