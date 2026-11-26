import { canonicalJson } from "@lervo/event-contract";
import { roleSha256 } from "./integrity.js";

/** The most bytes a research brief's inputs, and each source it reads, may hold. */
export const MAX_RESEARCH_INPUT_BYTES = 128 * 1024;

export interface ResearchSourcePolicyV1 {
  schemaVersion: 1;
  kind: "research.source_policy";
  policyId: string;
  version: 1;
  projectId: string;
  allowedPaths: string[];
  maximumSources: number;
  maximumSourceBytes: number;
  maximumAgeMs: number;
  allowNetwork: false;
}
export interface ResearchSourceV1 {
  sourceId: string;
  url: string;
  path: string;
  retrievedAt: string;
  contentHash: string;
  text: string;
}
export interface ResearchInputsV1 {
  schemaVersion: 1;
  kind: "research.inputs";
  researchQuestion: string;
  sourceConstraints: { sourceKind: "repository"; allowedPaths: string[] };
  policy: ResearchSourcePolicyV1;
  policyHash: string;
  roleContractHash: string;
  sources: ResearchSourceV1[];
}

export const researchSourcePolicyPath = ".lervo/research/source-policy.json";
export const researchContractHash = (value: unknown) => roleSha256(canonicalJson(value));
export const researchSourceUrl = (projectId: string, path: string) =>
  `lervo-repository://${projectId}/${path.split("/").map(encodeURIComponent).join("/")}`;

export function assertResearchSourcePolicy(policy: ResearchSourcePolicyV1): void {
  if (
    policy === null ||
    typeof policy !== "object" ||
    Object.keys(policy).length !== 10 ||
    policy.schemaVersion !== 1 ||
    policy.kind !== "research.source_policy" ||
    policy.version !== 1 ||
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(policy.policyId) ||
    !/^prj_[a-f0-9]{16}$/u.test(policy.projectId) ||
    policy.allowNetwork !== false ||
    !Array.isArray(policy.allowedPaths) ||
    policy.allowedPaths.length < 1 ||
    policy.allowedPaths.length > 8 ||
    new Set(policy.allowedPaths).size !== policy.allowedPaths.length ||
    policy.allowedPaths.some(
      (path) =>
        typeof path !== "string" ||
        path.length > 1024 ||
        !/^[A-Za-z0-9_][A-Za-z0-9_./ -]*$/u.test(path) ||
        path
          .split("/")
          .some((part) => !part || part === "." || part === ".." || part.startsWith(".")),
    ) ||
    !Number.isSafeInteger(policy.maximumSources) ||
    policy.maximumSources < 1 ||
    policy.maximumSources > 8 ||
    policy.allowedPaths.length > policy.maximumSources ||
    !Number.isSafeInteger(policy.maximumSourceBytes) ||
    policy.maximumSourceBytes < 1 ||
    policy.maximumSourceBytes > 32768 ||
    !Number.isSafeInteger(policy.maximumAgeMs) ||
    policy.maximumAgeMs < 1000 ||
    policy.maximumAgeMs > 86400000
  )
    throw new Error(
      "The research source policy must bound explicit repository sources without network authority.",
    );
}

export function assertResearchInputs(input: ResearchInputsV1, now: string): void {
  if (input === null || typeof input !== "object" || Object.keys(input).length !== 8)
    throw new Error("The research input contract is invalid.");
  assertResearchSourcePolicy(input.policy);
  if (
    input.schemaVersion !== 1 ||
    input.kind !== "research.inputs" ||
    typeof input.researchQuestion !== "string" ||
    !input.researchQuestion.trim() ||
    input.researchQuestion.length > 4000 ||
    input.policyHash !== researchContractHash(input.policy) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.roleContractHash) ||
    input.sourceConstraints === null ||
    Object.keys(input.sourceConstraints).length !== 2 ||
    input.sourceConstraints.sourceKind !== "repository" ||
    researchContractHash(input.sourceConstraints.allowedPaths) !==
      researchContractHash(input.policy.allowedPaths) ||
    !Array.isArray(input.sources) ||
    input.sources.length !== input.policy.allowedPaths.length ||
    !Number.isFinite(Date.parse(now)) ||
    Buffer.byteLength(canonicalJson(input)) > MAX_RESEARCH_INPUT_BYTES
  )
    throw new Error(
      "The research question, source constraints, or input size differs from its policy.",
    );
  input.sources.forEach((source, index) => {
    const age = Date.parse(now) - Date.parse(source.retrievedAt);
    if (
      Object.keys(source).length !== 6 ||
      source.sourceId !== `S${index + 1}` ||
      source.path !== input.policy.allowedPaths[index] ||
      source.url !== researchSourceUrl(input.policy.projectId, source.path) ||
      typeof source.text !== "string" ||
      !source.text.trim() ||
      Buffer.byteLength(source.text) > input.policy.maximumSourceBytes ||
      source.contentHash !== roleSha256(source.text) ||
      !Number.isFinite(age) ||
      age < -5000 ||
      age > input.policy.maximumAgeMs
    )
      throw new Error(
        "A research source has changed bytes, identity, provenance, or retrieval age.",
      );
  });
}
