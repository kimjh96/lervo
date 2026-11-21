import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { reviewKnowledgeJson } from "../src/provider-call.js";

export const CANONICAL_SOURCE = "src/runtime.ts";
export const CANONICAL_TARGET = "docs/specs/runtime.md";
export const INTEGRATED_REQUIREMENT = "Background model calls are limited to two per host.";

const NO_CHANGE =
  "This exact source preserves the existing local runtime contract. No new durable fact or behavioral obligation requires a canonical change.";
const APPROVAL =
  "Each supplied source has been independently compared with the exact current instructions and documentation. The current durable runtime requirement remains fully preserved.";

/** Every provider call the stand-in answered, in order; a test file resets it per case. */
export const canonicalProviderCalls: { task: string; untrustedSourceData: unknown }[] = [];

/** The canonical stage that this fixture's text provider would draft for the observed source. */
export function reviewedRuntimeDraft(target: {
  path: string;
  content: string;
  contentHash: string;
}) {
  return {
    path: target.path,
    beforeHash: target.contentHash,
    content: `${target.content}\n${INTEGRATED_REQUIREMENT}\n`,
  };
}

/**
 * Answers canonical assessment and review like the repository's provider fixture: the observed
 * runtime source asks for one reviewed specification draft and every other source needs no change.
 * It replaces all of `reviewKnowledgeJson`, so provider admission, the batch budget reservation,
 * the review cache and usage measurement do not run; workforce and stage contracts stay real.
 */
export const canonicalFixtureReview: typeof reviewKnowledgeJson = async (input) => {
  canonicalProviderCalls.push({ task: input.task, untrustedSourceData: input.untrustedSourceData });
  // It answers only from the view and schema a real provider receives (ADR-0604).
  const data = input.untrustedSourceData as {
    sources: { source: string; path: string; content?: string }[];
    context: { document: string; path: string; content: string }[];
  };
  let value: unknown;
  if (input.task === "canonical_baseline_assessment") {
    const decisions = data.sources.map((source) => ({
      source: source.source,
      sourcePath: source.path,
      disposition: "no_change",
      rationale: NO_CHANGE,
      canonicalReferences: [],
    }));
    const source = decisions.find((decision) => decision.sourcePath === CANONICAL_SOURCE);
    const target =
      data.sources.find((item) => item.path === CANONICAL_TARGET && item.content !== undefined) ??
      data.context.find((item) => item.path === CANONICAL_TARGET);
    if (source === undefined || target === undefined) value = { decisions, drafts: [] };
    else {
      source.disposition = "candidate";
      const { path, content } = reviewedRuntimeDraft({
        path: target.path,
        content: target.content!,
        contentHash: "",
      });
      value = { decisions, drafts: [{ path, content }] };
    }
  } else if (input.task === "independent_canonical_review")
    value = { decision: "approve", rationale: APPROVAL };
  else throw new Error(`Unexpected fixture provider task ${input.task}.`);
  return {
    value,
    usage: { fixture: true },
    admissionObservationHash: sha256(`admission:${canonicalJson(value)}`),
    observationArtifactHash: sha256(canonicalJson(value)),
  };
};
