import { canonicalJson } from "@lervo/event-contract";
import { assertProviderPromptAsksNoHashCopy } from "@lervo/schemas";
import { roleSha256 } from "./integrity.js";
import {
  assertResearchInputs,
  researchContractHash,
  type ResearchInputsV1,
} from "./research-contract.js";

export interface ResearchBriefManifestV1 {
  schemaVersion: 1;
  kind: "research.brief";
  inputHash: string;
  sources: { sourceId: string; url: string; retrievedAt: string; contentHash: string }[];
}

/** Deterministic schema and traceability checks; source meaning still requires a separate evaluator. */
export function verifyResearchBrief(input: {
  content: string;
  inputs: ResearchInputsV1;
  now: string;
}) {
  assertResearchInputs(input.inputs, input.now);
  if (Buffer.byteLength(input.content) > 65536 || !input.content.trim())
    throw new Error("The research brief is empty or exceeds its byte bound.");
  const marker = "<!-- lervo-research ";
  const offset = input.content.indexOf(marker);
  if (
    offset < 0 ||
    offset !== input.content.lastIndexOf(marker) ||
    !input.content.trimEnd().endsWith(" -->")
  )
    throw new Error("The research brief requires one final versioned provenance manifest.");
  const body = input.content.slice(0, offset).trim();
  const comment = JSON.parse(input.content.trimEnd().slice(offset + marker.length, -4)) as
    ResearchBriefManifestV1 | ResearchBriefCitationsV2;
  // ADR-0608: the worker cites its sources by id; Lervo binds each one's URL, retrieval time and
  // content hash, and the input hash, from the prepared inputs. A brief recorded before cites the
  // whole manifest and is still checked against it.
  const manifest = bindResearchManifest(comment, input.inputs);
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Object.keys(manifest).length !== 4 ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "research.brief" ||
    manifest.inputHash !== researchContractHash(input.inputs) ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length < 1 ||
    manifest.sources.length > input.inputs.sources.length ||
    new Set(manifest.sources.map((source) => source.sourceId)).size !== manifest.sources.length ||
    body.length < 32
  )
    throw new Error("The research brief schema differs from its exact prepared input.");
  const definitions = body.split(/\r?\n/u).filter((line) => /^\[\^[^\]]+\]:/u.test(line));
  const narrative = body
    .split(/\r?\n/u)
    .filter((line) => !/^\[\^[^\]]+\]:/u.test(line))
    .join("\n");
  const cited = [...narrative.matchAll(/\[\^([^\]]+)\]/gu)].map((match) => match[1]!);
  if (
    definitions.length !== manifest.sources.length ||
    cited.length === 0 ||
    cited.some((id) => !manifest.sources.some((source) => source.sourceId === id))
  )
    throw new Error("The research brief has missing or unbound source citations.");
  for (const source of manifest.sources) {
    const original = input.inputs.sources.find((item) => item.sourceId === source.sourceId);
    if (
      original === undefined ||
      Object.keys(source).length !== 4 ||
      source.url !== original.url ||
      source.retrievedAt !== original.retrievedAt ||
      source.contentHash !== original.contentHash ||
      !cited.includes(source.sourceId) ||
      definitions.filter((line) => line === `[^${source.sourceId}]: ${source.url}`).length !== 1
    )
      throw new Error(
        "A research citation differs from its captured URL, retrieval time, or source bytes.",
      );
  }
  return {
    schemaVersion: 1 as const,
    kind: "research.artifact_verification" as const,
    inputHash: manifest.inputHash,
    resultContentHash: roleSha256(input.content),
    policyHash: input.inputs.policyHash,
    roleContractHash: input.inputs.roleContractHash,
    status: "passed" as const,
    checks: ["research.artifact-schema", "research.source-traceability"],
    sourceHashes: manifest.sources.map((source) => source.contentHash),
    manifest,
    body,
  };
}

export function researchBriefInstructions(inputs: ResearchInputsV1) {
  const citations: ResearchBriefCitationsV2 = {
    schemaVersion: 2,
    kind: "research.brief",
    sources: inputs.sources.map(({ sourceId }) => sourceId),
  };
  const lines = [
    "Return an English Markdown research brief answering researchQuestion using only the supplied repository sources. Preserve source limitations. Network access has not been granted.",
    "Support each major conclusion with Markdown footnote references such as [^S1]. End the prose with one definition per cited source, exactly [^S1]: <the supplied URL>. Then append one final provenance comment that lists the ids of the cited sources only; Lervo records each source's retrieval time and content itself. Never invent evidence.",
    `Provenance comment format: <!-- lervo-research ${canonicalJson(citations)} -->`,
    "The deterministic verifier checks schema and provenance. A separate evaluator checks citation meaning and claim support; do not claim those checks passed yourself.",
    `Exact prepared research inputs: ${canonicalJson(inputs)}`,
  ];
  // ADR-0608: refused at build time if any line ever asks to copy a hash again.
  assertProviderPromptAsksNoHashCopy(...lines.slice(0, -1));
  return lines.join("\n\n");
}

/** ADR-0608: the provenance a worker writes: the ids of the sources it cited, nothing it copies. */
export interface ResearchBriefCitationsV2 {
  schemaVersion: 2;
  kind: "research.brief";
  sources: string[];
}

/** The full manifest of a brief's provenance comment, bound from the prepared inputs. */
function bindResearchManifest(
  comment: ResearchBriefManifestV1 | ResearchBriefCitationsV2,
  inputs: ResearchInputsV1,
): ResearchBriefManifestV1 {
  if (comment === null || typeof comment !== "object" || comment.kind !== "research.brief")
    throw new Error("The research brief schema differs from its exact prepared input.");
  if (comment.schemaVersion === 1) return comment;
  if (
    comment.schemaVersion !== 2 ||
    Object.keys(comment).length !== 3 ||
    !Array.isArray(comment.sources) ||
    !comment.sources.every((id) => typeof id === "string")
  )
    throw new Error("The research brief schema differs from its exact prepared input.");
  return {
    schemaVersion: 1,
    kind: "research.brief",
    inputHash: researchContractHash(inputs),
    sources: comment.sources.map((sourceId) => {
      const original = inputs.sources.find((item) => item.sourceId === sourceId);
      if (original === undefined)
        throw new Error("The research brief has missing or unbound source citations.");
      const { url, retrievedAt, contentHash } = original;
      return { sourceId, url, retrievedAt, contentHash };
    }),
  };
}
