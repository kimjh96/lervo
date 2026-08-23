import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import { FileSystemCas } from "@lervo/cas";
import { defaultEnglishWritingContract } from "@lervo/core";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";
import type {
  DocumentRegistry,
  DeliberationPolicy,
  HandoffBundle,
  RoleProfile,
  SharedContextPublication,
} from "@lervo/schemas";
import { writingPolicyHash } from "@lervo/writing-contract";

export const projectId = "prj_deliberation_runtime";
export const deliberationId = "dlb_runtime_fixture_0001";
export const policyVersion = hash("runtime-policy-v1");
export const writingPolicyContent = `${JSON.stringify(defaultEnglishWritingContract, null, 2)}\n`;
export const writingPolicyContentHash = hash(writingPolicyContent);
export const proposalPath = ".lervo/generated/deliberation/proposal.md";
export const proposalDocumentId = "doc_deliberation_proposal";
export const claimId = "clm_runtime_claim_0001";
export const objectionId = "obj_runtime_objection_0001";

const roots: string[] = [];

export function hash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(8, "0")}`;
}

export function clock(): () => Date {
  let value = Date.parse("2026-08-19T00:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

function documentRecord(path: string) {
  return {
    path,
    kind: "canonical" as const,
    responsibleParty: { kind: "team" as const, id: "team_lervo" },
    connectedPaths: [],
    verifiedRevision: "fixture-v1",
    verifiedAt: "2026-08-19T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" as const },
  };
}

export function registry(includeProposal = false): DocumentRegistry {
  return {
    schemaVersion: 1,
    documents: {
      doc_writing_policy: documentRecord("docs/writing.json"),
      ...(includeProposal
        ? { [proposalDocumentId]: documentRecord(proposalPath) }
        : {}),
    },
  };
}

function role(
  roleId: "proposer" | "reviewer",
  artifactKind: "proposal" | "review",
  allowedRoleIds: string[],
): RoleProfile {
  return {
    schemaVersion: 1,
    roleId,
    name: roleId,
    description: `Performs the ${artifactKind} role.`,
    requestTypes: ["deliberation"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind,
      schemaRef: `lervo-schema://fixture/${artifactKind}/v1`,
      pathTemplate: ".lervo/generated/deliberation/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "ko-KR",
        writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      },
    },
    verification: { suiteIds: ["fixture.required"], failureDisposition: "fail_run" },
    handoff: {
      allowedRoleIds,
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}

export const proposerRole = role("proposer", "proposal", ["reviewer"]);
export const reviewerRole = role("reviewer", "review", []);

export interface RuntimeFixture {
  root: string;
  events: SQLiteEventStore;
  artifacts: FileSystemCas;
}

export async function createRuntimeFixture(): Promise<RuntimeFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-runtime-"));
  roots.push(root);
  await Promise.all([
    mkdir(resolve(root, ".lervo/state/cas"), { recursive: true }),
    mkdir(resolve(root, ".lervo/generated/deliberation"), { recursive: true }),
    mkdir(resolve(root, "docs"), { recursive: true }),
    mkdir(resolve(root, "src"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(root, "AGENTS.md"), "Deliberation participants check evidence and answer in English.\n"),
    writeFile(resolve(root, "docs/writing.json"), writingPolicyContent),
  ]);
  return {
    root,
    events: await SQLiteEventStore.open({
      path: resolve(root, ".lervo/state/events.sqlite"),
      projectId,
    }),
    artifacts: await FileSystemCas.open(resolve(root, ".lervo/state/cas")),
  };
}

export function coordinator(input: {
  fixture: RuntimeFixture;
  adapter: ProviderAdapter;
  role: RoleProfile;
  runId: string;
  sessionId: string;
  now: () => Date;
}) {
  return new ManagedProviderRunCoordinator({
    adapter: input.adapter,
    coordinates: {
      projectId,
      runId: input.runId,
      sessionId: input.sessionId,
      roleId: input.role.roleId,
    },
    policyVersion,
    events: input.fixture.events,
    artifactStore: input.fixture.artifacts,
    now: input.now,
    createEventId: sequence(`evt_${input.role.roleId}`),
  });
}

export function managedInput(input: {
  root: string;
  role: RoleProfile;
  includeProposal?: boolean;
  publications?: SharedContextPublication[];
  handoff?: HandoffBundle;
}) {
  const publications = input.publications ?? [];
  return {
    repositoryRoot: input.root,
    requestDigest: hash(`${input.role.roleId}:request`),
    risk: "low",
    instructions: input.role.roleId === "proposer"
      ? "Write a design proposal with supporting evidence."
      : "Review the proposal and describe any blocking objection concretely.",
    targetTurnId: `target-${input.role.roleId}-0001`,
    context: {
      registry: registry(input.includeProposal),
      role: input.role,
      expectedPaths: ["src/decision.ts"],
      documentRules: { "writing.policy": ["doc_writing_policy"] },
      publications,
      handoffs: input.handoff === undefined
        ? []
        : [{ bundle: input.handoff, producerRole: proposerRole }],
      createReceiptId: sequence(`ctx_${input.role.roleId}_e12`),
    },
    writingPolicy: {
      writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      documentId: "doc_writing_policy",
      contentHash: writingPolicyContentHash,
    },
    resolvedSkills: [],
    createEnvelopeId: sequence(`env_${input.role.roleId}`),
    createEvidenceReceiptId: sequence(`ctx_${input.role.roleId}_e3`),
  };
}

export function passingEvaluator() {
  return {
    async evaluate(request: import("@lervo/writing").SemanticWritingEvaluationRequest) {
      return {
        evaluator: { kind: "model" as const, evaluatorId: "fixture.korean-review.v1" },
        checks: request.checks.map((check) => ({
          checkId: check.checkId,
          status: "passed" as const,
          violationCount: 0,
        })),
      };
    },
  };
}

export function policyWithProviders(
  proposerProvider: "codex" | "claude",
  reviewerProvider: "codex" | "claude",
): DeliberationPolicy {
  return {
    schemaVersion: 1,
    policyId: "deliberation_runtime-fixture",
    projectId,
    participants: [
      {
        roleId: "proposer",
        responsibilities: ["proposer", "decision_owner"],
        providerSelection: { mode: "fixed", provider: proposerProvider },
      },
      {
        roleId: "reviewer",
        responsibilities: ["reviewer", "verifier"],
        providerSelection: { mode: "fixed", provider: reviewerProvider },
      },
    ],
    decisionOwnerRoleId: "proposer",
    maxRounds: 1,
    requiredVerificationSuiteIds: ["fixture.required"],
    convergence: {
      requireIndependentReviewer: true,
      requireIndependentSessions: true,
      requireDecisionOwnerDecision: true,
      requirePassedVerifications: true,
      requireZeroUnresolvedBlockingObjections: true,
      unresolvedBlockingDisposition: "no_consensus",
    },
    publication: {
      surface: "chat",
      writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      writingPolicyHash: writingPolicyHash(defaultEnglishWritingContract),
      requiresWritingPermit: true,
    },
  };
}

export const policy = policyWithProviders("codex", "codex");

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
}
