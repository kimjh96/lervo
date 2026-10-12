import { canonicalHash } from "@lervo/search";
import {
  validateSchema,
  type ContextQualityBindings,
  type ContextQualityIngress,
  type ContextQualityRequest,
  type ContextQualityReasonCode,
} from "@lervo/schemas";

import { normalizeRepositoryPath } from "./paths.js";

export class ContextQualityError extends Error {
  constructor(readonly code: ContextQualityReasonCode) {
    super(`Context quality preparation failed: ${code}.`);
    this.name = "ContextQualityError";
  }
}

/** Normalize syntax only. Neither task text nor origin can assert authority or capabilities. */
export function normalizeContextQualityIngress(value: unknown): ContextQualityIngress {
  if (!validateSchema("contextQualityIngress", value).valid)
    throw new ContextQualityError("context_contract_invalid");
  const input = structuredClone(value as ContextQualityIngress);
  if (Buffer.byteLength(JSON.stringify(input.task), "utf8") > 16384)
    throw new ContextQualityError("context_contract_invalid");
  try {
    input.task.targetPaths = [
      ...new Set(input.task.targetPaths.map(normalizeRepositoryPath)),
    ].sort();
  } catch {
    // eslint-disable-next-line lervo/require-caught-error-cause -- Boundary errors must not retain private caller paths or text through cause.
    throw new ContextQualityError("context_contract_invalid");
  }
  input.task.artifactKinds.sort();
  input.task.requestedActions.sort();
  input.task.retrievalLanguages = [
    ...new Set(input.task.retrievalLanguages.map((v) => v.toLowerCase())),
  ].sort();
  input.task.conversationLocale = input.task.conversationLocale?.toLowerCase() ?? null;
  input.task.publicationLocale = input.task.publicationLocale?.toLowerCase() ?? null;
  return input;
}

export function contextQualityTaskDigest(ingress: ContextQualityIngress): string {
  return canonicalHash(normalizeContextQualityIngress(ingress).task);
}

function semanticProjection(request: Omit<ContextQualityRequest, "semanticInputDigest">) {
  return {
    projectId: request.projectId,
    taskRevision: request.taskRevision,
    taskDigest: request.taskDigest,
    scopeDigest: request.scopeDigest,
    policySetDigest: request.policySetDigest,
    sourceSnapshotId: request.sourceSnapshotId,
    retrievalPlanId: request.retrievalPlanId,
    profileId: request.profileId,
    profileDigest: request.profileDigest,
    builds: request.builds,
    projectedQueries: request.projectedQueries,
  };
}

/** Bind coordinates supplied by an application authority resolver, never ingress metadata. */
export function bindContextQualityRequest(
  value: unknown,
  bindings: ContextQualityBindings,
): ContextQualityRequest {
  const input = normalizeContextQualityIngress(value);
  if (!validateSchema("contextQualityBindings", bindings).valid)
    throw new ContextQualityError("context_binding_unavailable");
  if (
    bindings.projectId !== input.projectId ||
    bindings.taskRevision !== input.taskRevision ||
    bindings.taskDigest !== canonicalHash(input.task)
  )
    throw new ContextQualityError("context_binding_stale");
  const request = {
    ...input,
    ...structuredClone(bindings),
    profileDigest: canonicalHash(bindings.profile),
  };
  return { ...request, semanticInputDigest: canonicalHash(semanticProjection(request)) };
}

/** A matching digest proves internal consistency, not the authority of its supplier. */
export function validateContextQualityRequest(
  value: unknown,
): asserts value is ContextQualityRequest {
  if (!validateSchema("contextQualityRequest", value).valid)
    throw new ContextQualityError("context_contract_invalid");
  const request = value as ContextQualityRequest;
  const ingress = {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    projectId: request.projectId,
    taskRevision: request.taskRevision,
    task: request.task,
    origin: request.origin,
  };
  const normalized = normalizeContextQualityIngress(ingress);
  if (
    canonicalHash(normalized.task) !== canonicalHash(request.task) ||
    request.taskDigest !== canonicalHash(request.task) ||
    request.profileDigest !== canonicalHash(request.profile) ||
    request.semanticInputDigest !== canonicalHash(semanticProjection(request))
  )
    throw new ContextQualityError("context_binding_stale");
}
