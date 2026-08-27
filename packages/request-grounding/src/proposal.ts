import {
  groundingAuthorities,
  groundingDispositions,
  groundingIntents,
  groundingReferenceKinds,
  groundingSourceClasses,
  protocolCoordinateKinds,
  type GroundingReference,
  type ProtocolCoordinate,
  type SemanticGroundingProposal,
} from "./types.js";
import { validateProtocolCoordinate } from "./protocol-coordinate.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;
const PROVIDER_ID = /^[a-z][a-z0-9._-]{0,63}$/u;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, fields: readonly string[], owner: string): void {
  const allowed = new Set(fields);
  if (
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${owner} contains unsupported or missing fields.`);
  }
}

function boundedIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 160 || !IDENTIFIER.test(value)) {
    throw new TypeError(`${field} must be a bounded identifier.`);
  }
  return value;
}

function uniqueIdentifiers(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${field} must be a bounded array.`);
  }
  const items = value.map((item, index) => boundedIdentifier(item, `${field}[${index}]`));
  if (new Set(items).size !== items.length) throw new TypeError(`${field} must be unique.`);
  return items;
}

function boundedReasons(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("ambiguityReasons must be a bounded array.");
  }
  const reasons = value.map((item) => boundedIdentifier(item, "ambiguityReasons item"));
  if (new Set(reasons).size !== reasons.length) {
    throw new TypeError("ambiguityReasons must be unique.");
  }
  return reasons;
}

function boundedQueries(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new TypeError("retrievalQueries must be a bounded array.");
  }
  const queries = value.map((item) => {
    if (typeof item !== "string" || item.length < 1 || Buffer.byteLength(item) > 512) {
      throw new TypeError("retrievalQueries contains an invalid query.");
    }
    return item;
  });
  if (new Set(queries).size !== queries.length) {
    throw new TypeError("retrievalQueries must be unique.");
  }
  return queries;
}

function references(value: unknown): GroundingReference[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("references must be a bounded array.");
  }
  const parsed = value.map((item, index) => {
    const input = record(item, `references[${index}]`);
    exactKeys(input, ["referenceId", "kind", "resolution"], `references[${index}]`);
    if (!groundingReferenceKinds.includes(input.kind as never)) {
      throw new TypeError(`references[${index}].kind is invalid.`);
    }
    if (input.resolution !== "resolved" && input.resolution !== "unresolved") {
      throw new TypeError(`references[${index}].resolution is invalid.`);
    }
    return {
      referenceId: boundedIdentifier(input.referenceId, `references[${index}].referenceId`),
      kind: input.kind as GroundingReference["kind"],
      resolution: input.resolution as GroundingReference["resolution"],
    };
  });
  if (new Set(parsed.map((item) => item.referenceId)).size !== parsed.length) {
    throw new TypeError("references must use unique IDs.");
  }
  return parsed;
}

function protocolCoordinates(value: unknown): ProtocolCoordinate[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("protocolCoordinates must be a bounded array.");
  }
  const parsed = value.map((item, index) => {
    const input = record(item, `protocolCoordinates[${index}]`);
    exactKeys(input, ["kind", "value"], `protocolCoordinates[${index}]`);
    if (!protocolCoordinateKinds.includes(input.kind as never) || typeof input.value !== "string") {
      throw new TypeError(`protocolCoordinates[${index}] is invalid.`);
    }
    return validateProtocolCoordinate({
      kind: input.kind as ProtocolCoordinate["kind"],
      value: input.value,
    });
  });
  if (new Set(parsed.map((item) => `${item.kind}:${item.value}`)).size !== parsed.length) {
    throw new TypeError("protocolCoordinates must be unique.");
  }
  return parsed;
}

function sourceClasses(value: unknown): SemanticGroundingProposal["sourceClasses"] {
  if (!Array.isArray(value) || value.length > groundingSourceClasses.length) {
    throw new TypeError("sourceClasses must be a bounded array.");
  }
  if (value.some((item) => !groundingSourceClasses.includes(item as never))) {
    throw new TypeError("sourceClasses contains an invalid value.");
  }
  if (new Set(value).size !== value.length) throw new TypeError("sourceClasses must be unique.");
  return value as SemanticGroundingProposal["sourceClasses"];
}

function resolver(value: unknown): SemanticGroundingProposal["resolver"] {
  const input = record(value, "resolver");
  exactKeys(input, ["kind", "providerId", "resultDigest"], "resolver");
  if (
    input.kind !== "provider_adapter" ||
    typeof input.providerId !== "string" ||
    !PROVIDER_ID.test(input.providerId) ||
    typeof input.resultDigest !== "string" ||
    !HASH.test(input.resultDigest)
  ) {
    throw new TypeError("resolver is invalid.");
  }
  return input as unknown as SemanticGroundingProposal["resolver"];
}

function providerRoute(value: unknown): SemanticGroundingProposal["providerRoute"] {
  const input = record(value, "providerRoute");
  exactKeys(input, ["mode", "providerIds"], "providerRoute");
  if (!Array.isArray(input.providerIds) || input.providerIds.length > 8) {
    throw new TypeError("providerRoute.providerIds must be a bounded array.");
  }
  const providerIds = input.providerIds.map((item) => {
    if (typeof item !== "string" || !PROVIDER_ID.test(item)) {
      throw new TypeError("providerRoute contains an invalid provider ID.");
    }
    return item;
  });
  if (new Set(providerIds).size !== providerIds.length) {
    throw new TypeError("providerRoute provider IDs must be unique.");
  }
  if (input.mode === "current_provider_only" && providerIds.length === 0) {
    return { mode: input.mode, providerIds: [] };
  }
  if (input.mode === "cross_provider_deliberation" && providerIds.length >= 2) {
    return { mode: input.mode, providerIds };
  }
  throw new TypeError("providerRoute mode and providers disagree.");
}

export function parseSemanticGroundingProposal(value: unknown): SemanticGroundingProposal {
  const input = record(value, "semantic grounding proposal");
  exactKeys(
    input,
    [
      "schemaVersion",
      "requestDigest",
      "resolver",
      "intent",
      "subjectIds",
      "references",
      "protocolCoordinates",
      "requestedEffectIds",
      "prohibitedEffectIds",
      "sourceClasses",
      "retrievalQueries",
      "workflowCandidateIds",
      "capabilityCandidateIds",
      "authorityRequirement",
      "providerRoute",
      "disposition",
      "ambiguityReasons",
    ],
    "semantic grounding proposal",
  );
  if (input.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1.");
  if (typeof input.requestDigest !== "string" || !HASH.test(input.requestDigest)) {
    throw new TypeError("requestDigest is invalid.");
  }
  if (!groundingIntents.includes(input.intent as never)) throw new TypeError("intent is invalid.");
  if (!groundingAuthorities.includes(input.authorityRequirement as never)) {
    throw new TypeError("authorityRequirement is invalid.");
  }
  if (!groundingDispositions.includes(input.disposition as never)) {
    throw new TypeError("disposition is invalid.");
  }
  const requestedEffectIds = uniqueIdentifiers(input.requestedEffectIds, "requestedEffectIds", 16);
  const prohibitedEffectIds = uniqueIdentifiers(
    input.prohibitedEffectIds,
    "prohibitedEffectIds",
    16,
  );
  if (requestedEffectIds.some((item) => prohibitedEffectIds.includes(item))) {
    throw new TypeError("An effect cannot be both requested and prohibited.");
  }
  return {
    schemaVersion: 1,
    requestDigest: input.requestDigest,
    resolver: resolver(input.resolver),
    intent: input.intent as SemanticGroundingProposal["intent"],
    subjectIds: uniqueIdentifiers(input.subjectIds, "subjectIds", 16),
    references: references(input.references),
    protocolCoordinates: protocolCoordinates(input.protocolCoordinates),
    requestedEffectIds,
    prohibitedEffectIds,
    sourceClasses: sourceClasses(input.sourceClasses),
    retrievalQueries: boundedQueries(input.retrievalQueries),
    workflowCandidateIds: uniqueIdentifiers(input.workflowCandidateIds, "workflowCandidateIds", 8),
    capabilityCandidateIds: uniqueIdentifiers(
      input.capabilityCandidateIds,
      "capabilityCandidateIds",
      16,
    ),
    authorityRequirement:
      input.authorityRequirement as SemanticGroundingProposal["authorityRequirement"],
    providerRoute: providerRoute(input.providerRoute),
    disposition: input.disposition as SemanticGroundingProposal["disposition"],
    ambiguityReasons: boundedReasons(input.ambiguityReasons),
  };
}
