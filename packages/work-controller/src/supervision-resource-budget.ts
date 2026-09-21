import type { ResourceGroupObservationV1 } from "@lervo/application-contract";
import {
  readResourceUsageEventPayload,
  resourceAccountingDescriptorHash,
} from "@lervo/execution-contract";
import type { EventEnvelope, ResourceAccountingDescriptor } from "@lervo/schemas";

/** Derive one supervision total from exact same-counter groups without changing their reports. */
export function comparableSupervisionResourceTotal(input: {
  runIds: readonly string[];
  groups: readonly ResourceGroupObservationV1[];
  events: readonly EventEnvelope[];
  descriptors: ReadonlyMap<string, ResourceAccountingDescriptor>;
}): number | null {
  const first = input.groups[0];
  if (first === undefined || input.groups.length < 2) return null;
  const runs = new Set(input.runIds);
  if (runs.size === 0 || runs.size !== input.runIds.length) return null;
  const covered = new Set<string>();
  const effectiveDescriptors = new Set<string>();
  const counterSemanticsDescriptors = new Set<string>();
  const requestedModels = new Set<string | null>();
  let total = 0;
  for (const group of input.groups) {
    if (
      group.completeness !== "complete" ||
      group.source !== "provider_reported" ||
      group.scope !== "primary_provider" ||
      group.provider !== first.provider ||
      group.accountingMode !== first.accountingMode ||
      group.totalTokens === null ||
      !Number.isSafeInteger(group.totalTokens) ||
      group.totalTokens < 0
    )
      return null;
    const descriptor = input.descriptors.get(group.accountingDescriptorHash);
    if (
      descriptor === undefined ||
      resourceAccountingDescriptorHash(descriptor) !== group.accountingDescriptorHash ||
      descriptor.provider !== group.provider ||
      descriptor.accountingMode !== group.accountingMode ||
      descriptor.observationSupport !== "supported"
    )
      return null;
    requestedModels.add(descriptor.requestedModel);
    counterSemanticsDescriptors.add(
      resourceAccountingDescriptorHash({ ...descriptor, requestedModel: null }),
    );
    const observations = input.events.filter(
      (event) =>
        runs.has(event.runId) &&
        event.type === "resource.usage.recorded" &&
        event.payload.accountingDescriptorHash === group.accountingDescriptorHash,
    );
    if (observations.length !== group.runCount) return null;
    let observedTotal = 0;
    for (const event of observations) {
      const usage = readResourceUsageEventPayload(event);
      const identity = usage?.modelIdentity;
      if (
        usage === null ||
        usage.status !== "observed" ||
        usage.source !== group.source ||
        usage.scope !== group.scope ||
        usage.accountingMode !== group.accountingMode ||
        event.actor.provider !== group.provider ||
        identity === undefined ||
        identity.provider !== group.provider ||
        identity.requestedModel !== descriptor.requestedModel ||
        identity.answerModel === null ||
        identity.unavailableReason !== null ||
        identity.observedModelIds.length !== 1 ||
        identity.observedModelIds[0] !== identity.answerModel ||
        (descriptor.requestedModel !== null &&
          descriptor.requestedModel !== identity.answerModel) ||
        usage.usage === null ||
        !Number.isSafeInteger(usage.usage.totalTokens) ||
        usage.usage.totalTokens < 0 ||
        covered.has(event.runId)
      )
        return null;
      covered.add(event.runId);
      observedTotal += usage.usage.totalTokens;
      effectiveDescriptors.add(
        resourceAccountingDescriptorHash({ ...descriptor, requestedModel: identity.answerModel }),
      );
    }
    if (observedTotal !== group.totalTokens) return null;
    total += observedTotal;
  }
  if (covered.size !== runs.size || !Number.isSafeInteger(total)) return null;
  const defaultAndExplicitSameModel =
    input.groups.length === 2 &&
    requestedModels.size === 2 &&
    requestedModels.has(null) &&
    effectiveDescriptors.size === 1;
  const explicitModelMigration =
    !requestedModels.has(null) &&
    requestedModels.size === input.groups.length &&
    counterSemanticsDescriptors.size === 1;
  return defaultAndExplicitSameModel || explicitModelMigration ? total : null;
}
