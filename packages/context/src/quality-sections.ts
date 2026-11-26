import { createHash } from "node:crypto";

import type { ContextQualityEvidence, ContextQualityRequest } from "@lervo/schemas";

import { ContextQualityError } from "./quality-request.js";
import { MAX_CONTEXT_SOURCE_BYTES } from "./source-limits.js";

export interface ContextQualitySourceBytes {
  sourceId: string;
  bytes: Uint8Array;
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Verify exact bounded source ranges before any loaded-clause claim. Never read a filesystem. */
export function validateQualitySections(
  request: ContextQualityRequest,
  evidence: ContextQualityEvidence,
  sources: readonly ContextQualitySourceBytes[],
) {
  if (
    sources.length > 64 ||
    sources.some(
      (s) => !(s.bytes instanceof Uint8Array) || s.bytes.byteLength > MAX_CONTEXT_SOURCE_BYTES,
    ) ||
    sources.reduce((n, s) => n + s.bytes.byteLength, 0) > request.profile.maximumRetainedBytes
  )
    throw new ContextQualityError("context_budget_exceeded");
  const sourceMap = new Map(sources.map((s) => [s.sourceId, s]));
  if (sourceMap.size !== sources.length) throw new ContextQualityError("context_contract_invalid");
  const sourceHashes = new Map<string, string>();
  const sectionKeys = new Set<string>();
  const ruleMap = new Map(evidence.obligations.map((r) => [r.ruleId, r]));
  if (ruleMap.size !== evidence.obligations.length)
    throw new ContextQualityError("context_contract_invalid");
  for (const rule of evidence.obligations) {
    if (rule.scopeDigest !== request.scopeDigest || rule.byteEnd <= rule.byteStart)
      throw new ContextQualityError("context_binding_stale");
  }
  for (const section of evidence.sections) {
    const source = sourceMap.get(section.sourceId);
    if (
      !source ||
      section.byteEnd <= section.byteStart ||
      section.byteEnd > source.bytes.byteLength
    )
      throw new ContextQualityError("context_required_section_missing");
    const sourceHash = sourceHashes.get(source.sourceId) ?? hash(source.bytes);
    sourceHashes.set(source.sourceId, sourceHash);
    const bytes = source.bytes.subarray(section.byteStart, section.byteEnd);
    if (sourceHash !== section.sourceHash || hash(bytes) !== section.sectionHash)
      throw new ContextQualityError("context_binding_stale");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // eslint-disable-next-line lervo/require-caught-error-cause -- Boundary errors must not retain private source content through cause.
      throw new ContextQualityError("context_contract_invalid");
    }
    const key = JSON.stringify([section.sourceId, section.byteStart, section.byteEnd]);
    if (sectionKeys.has(key)) throw new ContextQualityError("context_contract_invalid");
    sectionKeys.add(key);
    if (section.role === "evidence" && section.ruleIds.length !== 0)
      throw new ContextQualityError("context_contract_invalid");
    if (section.role === "obligation" && (!section.required || section.ruleIds.length === 0))
      throw new ContextQualityError("context_contract_invalid");
    for (const ruleId of section.ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (
        !rule ||
        rule.sourceId !== section.sourceId ||
        rule.sourceHash !== section.sourceHash ||
        section.byteStart > rule.byteStart ||
        section.byteEnd < rule.byteEnd
      )
        throw new ContextQualityError("context_required_section_missing");
    }
  }
  const directlyLoaded = new Set(evidence.sections.flatMap((s) => s.ruleIds));
  const required = evidence.obligations.filter((r) => r.disposition !== "not_applicable");
  const loaded = required.filter(
    (r) =>
      r.disposition === "applicable" &&
      directlyLoaded.has(r.ruleId) &&
      [...r.conditionRefs, ...r.exceptionRefs].every((ref) => directlyLoaded.has(ref)),
  );
  const loadedIds = new Set(loaded.map((r) => r.ruleId));
  const packedEvidenceCount = new Set(
    evidence.sections.filter((s) => s.role === "evidence").map((s) => s.sourceId),
  ).size;
  if (packedEvidenceCount > evidence.selectedEvidenceCount)
    throw new ContextQualityError("context_contract_invalid");
  return {
    required: required.length,
    resolved: required.filter((r) => r.disposition === "applicable").length,
    loaded: loaded.length,
    missingRuleIds: required
      .filter((r) => !loadedIds.has(r.ruleId))
      .map((r) => r.ruleId)
      .sort(),
    packedEvidenceCount,
    omittedOptionalEvidenceCount: evidence.selectedEvidenceCount - packedEvidenceCount,
    preparedByteCount: evidence.sections.reduce((n, s) => n + s.byteEnd - s.byteStart, 0),
  };
}
