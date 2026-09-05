import { validateSchema, type SkillManifest } from "@lervo/schemas";
import { hashSkillContentFiles } from "@lervo/skills";

import { sha256 } from "./integrity.js";

export interface PassedWorkflowVerificationEvidence {
  eventId: string;
  eventHash: string;
  runId: string;
  verificationId: string;
  suiteHash: string;
  repositoryRevision: string;
  resultContentHash: string;
}

export interface PortableSkillResourceProposal {
  path: string;
  content: string;
  purpose: string;
  required: boolean;
}

export interface PortableSkillContractProposal {
  skillId: string;
  version: string;
  supportedRoles: string[];
  providerCompatibility:
    { mode: "any" } | { mode: "allowlist"; providers: Array<"codex" | "claude"> };
  minimumRuntimeVersion: string;
  platforms: Array<"darwin" | "linux" | "win32">;
  requiredTools: string[];
  requiredCapabilities: string[];
  inputSchemaRef: string;
  outputSchemaRef: string;
  resources: PortableSkillResourceProposal[];
}

export interface WorkflowVerificationReference extends PassedWorkflowVerificationEvidence {
  independentGroup: string;
}

export interface PortableSkillPackageCandidate {
  packageContentHash: string;
  manifestContent: string;
  manifestContentHash: string;
  resources: PortableSkillResourceProposal[];
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const coordinatePattern = /^(?:evt|run)_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const verificationPattern = /^ver_[a-f0-9]{16}$/u;

function boundedStrings(
  values: unknown,
  field: string,
  maximum: number,
): asserts values is string[] {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 512)
  )
    throw new Error(`${field} must contain bounded non-empty strings.`);
}

function validateVerificationReference(value: WorkflowVerificationReference): void {
  if (
    value.independentGroup.length === 0 ||
    value.independentGroup.length > 128 ||
    !coordinatePattern.test(value.eventId) ||
    !coordinatePattern.test(value.runId) ||
    !verificationPattern.test(value.verificationId) ||
    !hashPattern.test(value.eventHash) ||
    !hashPattern.test(value.suiteHash) ||
    !hashPattern.test(value.repositoryRevision) ||
    !hashPattern.test(value.resultContentHash)
  )
    throw new Error("Workflow verification evidence is unsafe or unbounded.");
}

export function assertExactPassedWorkflowVerification(
  references: WorkflowVerificationReference[],
  evidence: readonly PassedWorkflowVerificationEvidence[],
): void {
  const byEvent = new Map(evidence.map((item) => [item.eventId, item]));
  for (const reference of references) {
    validateVerificationReference(reference);
    const observed = byEvent.get(reference.eventId);
    if (
      observed === undefined ||
      Object.entries(observed).some(
        ([field, value]) => reference[field as keyof WorkflowVerificationReference] !== value,
      )
    )
      throw new Error("Workflow verification evidence is missing, failed, or changed.");
  }
}

function createPackage(input: {
  target: { path: string; content: string };
  contract: PortableSkillContractProposal;
}): PortableSkillPackageCandidate {
  const directory = input.target.path.slice(0, -"/SKILL.md".length);
  const expectedSkillId = directory.slice(directory.lastIndexOf("/") + 1);
  if (input.contract.skillId !== expectedSkillId)
    throw new Error("The portable-skill ID must equal its package directory.");
  boundedStrings(input.contract.supportedRoles, "supportedRoles", 32);
  boundedStrings(input.contract.platforms, "platforms", 3);
  boundedStrings(input.contract.requiredTools, "requiredTools", 32);
  boundedStrings(input.contract.requiredCapabilities, "requiredCapabilities", 8);
  if (
    input.contract.resources.length > 16 ||
    new Set(input.contract.resources.map((item) => item.path)).size !==
      input.contract.resources.length
  )
    throw new Error("Portable-skill resources must be bounded and unique.");
  let resourceBytes = 0;
  for (const resource of input.contract.resources) {
    resourceBytes += Buffer.byteLength(resource.content);
    const pathSegments = resource.path.split("/");
    if (
      !/^(?:references|scripts|assets)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:md|json|ya?ml|mjs)$/u.test(
        resource.path,
      ) ||
      pathSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
      resource.content.length === 0 ||
      resource.purpose.trim().length === 0 ||
      resource.purpose.length > 256 ||
      resourceBytes > 64 * 1024
    )
      throw new Error("A portable-skill resource is unsafe or unbounded.");
  }
  if (
    !/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$[\s\S]*?^---\s*$/mu.test(
      input.target.content,
    )
  )
    throw new Error("The portable-skill instructions require bounded frontmatter with a name.");
  const declaredName = input.target.content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/mu)?.[1];
  if (declaredName !== input.contract.skillId)
    throw new Error("The portable-skill instruction name must equal its contract ID.");
  const packageContentHash = hashSkillContentFiles([
    { path: "SKILL.md", bytes: new TextEncoder().encode(input.target.content) },
    ...input.contract.resources.map((item) => ({
      path: item.path,
      bytes: new TextEncoder().encode(item.content),
    })),
  ]);
  const manifest: SkillManifest = {
    schemaVersion: 1,
    skillId: input.contract.skillId,
    version: input.contract.version,
    contentHash: packageContentHash,
    source: {
      kind: "project",
      uri: directory,
      publisher: {
        id: "lervo.development-pattern",
        name: "Lervo development-pattern review",
      },
    },
    supportedRoles: [...input.contract.supportedRoles],
    compatibility: {
      providers: structuredClone(input.contract.providerCompatibility),
      minimumRuntimeVersion: input.contract.minimumRuntimeVersion,
      platforms: [...input.contract.platforms],
      requiredTools: [...input.contract.requiredTools],
      unknownIsCompatible: false,
    },
    requiredCapabilities: [
      ...input.contract.requiredCapabilities,
    ] as SkillManifest["requiredCapabilities"],
    contracts: {
      inputSchemaRef: input.contract.inputSchemaRef,
      outputSchemaRef: input.contract.outputSchemaRef,
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "disabled" },
    pinned: false,
  };
  if (!validateSchema("skill", manifest).valid)
    throw new Error("The proposed portable-skill contract is invalid.");
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    packageContentHash,
    manifestContent,
    manifestContentHash: sha256(manifestContent),
    resources: structuredClone(input.contract.resources),
  };
}

export function createPortableSkillPackageCandidate(input: {
  target: { kind: string; path: string; content: string };
  independentGroups: ReadonlySet<string>;
  verification: WorkflowVerificationReference[] | undefined;
  contract: PortableSkillContractProposal | undefined;
  passedVerificationEvidence: readonly PassedWorkflowVerificationEvidence[];
}): PortableSkillPackageCandidate | undefined {
  const enhanced = input.verification !== undefined || input.contract !== undefined;
  if (!enhanced) return undefined;
  if (
    input.target.kind !== "portable_skill" ||
    input.verification === undefined ||
    input.contract === undefined ||
    input.verification.length !== input.independentGroups.size ||
    new Set(input.verification.map((item) => item.independentGroup)).size !==
      input.verification.length ||
    [...input.independentGroups].some(
      (group) => !input.verification!.some((item) => item.independentGroup === group),
    ) ||
    new Set(input.verification.map((item) => item.eventId)).size !== input.verification.length ||
    new Set(input.verification.map((item) => item.runId)).size !== input.verification.length
  )
    throw new Error(
      "A portable-skill candidate requires one distinct passed verification per independent evidence group.",
    );
  assertExactPassedWorkflowVerification(input.verification, input.passedVerificationEvidence);
  return createPackage({ target: input.target, contract: input.contract });
}
