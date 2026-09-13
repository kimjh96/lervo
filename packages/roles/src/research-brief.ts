import { canonicalJson } from "@lervo/event-contract";
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
  const manifest = JSON.parse(
    input.content.trimEnd().slice(offset + marker.length, -4),
  ) as ResearchBriefManifestV1;
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
  const manifest: ResearchBriefManifestV1 = {
    schemaVersion: 1,
    kind: "research.brief",
    inputHash: researchContractHash(inputs),
    sources: inputs.sources.map(({ sourceId, url, retrievedAt, contentHash }) => ({
      sourceId,
      url,
      retrievedAt,
      contentHash,
    })),
  };
  return [
    "Return an English Markdown research brief answering researchQuestion using only the supplied repository sources. Preserve source limitations. Network access has not been granted.",
    "Support each major conclusion with Markdown footnote references such as [^S1]. End the prose with one definition per cited source, exactly [^S1]: <the supplied URL>. Then append one final provenance comment. Copy each cited source's exact URL, retrieval time and content hash; omit uncited sources from the manifest. Never invent evidence.",
    `Provenance comment format: <!-- lervo-research ${canonicalJson(manifest)} -->`,
    "The deterministic verifier checks schema and provenance. A separate evaluator checks citation meaning and claim support; do not claim those checks passed yourself.",
    `Exact prepared research inputs: ${canonicalJson(inputs)}`,
  ].join("\n\n");
}
