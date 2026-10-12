import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { SupervisedManagedInvocation } from "@lervo/node-runtime";
import type {
  ManagedWorkCausalityInput,
  ManagedProviderResultArtifact,
  ManagedFileChangeEvidence,
  ManagedProjectVerification,
} from "@lervo/orchestrator";
import type { HostOutcomePolicy, HostContextOutcomeReport } from "@lervo/repository-context";
import type { ProjectStorage } from "@lervo/project-storage";
import type { WritingPublicationResult, WritingSemanticEvaluator } from "@lervo/writing";
import type { AdapterCapabilityActivationReceipt } from "@lervo/schemas";
import type { ResolvedCapability } from "@lervo/capabilities";
import type { ManagedLinkedEvidenceCanaryAuthorization } from "./managed-linked-evidence-canary.js";
import type { ResolvedRunSkill } from "./run-skills.js";
import type { ManagedSearchContextSummary } from "./repository-context.js";
import type { LocalProviderWritingEvaluatorInput } from "./managed-writing-evaluator.js";
import type { PreparedRunVerification } from "./run-verification.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";
import type { resolveDefaultManagedLinkedEvidenceSelection } from "./managed-linked-evidence-default-selection.js";

export type RunProvider = "codex" | "claude";

export interface ManagedRunRequest {
  repositoryRoot: string;
  provider: RunProvider;
  expectedPath?: string;
  expectedPaths?: readonly string[];
  instructions: string;
  executionKey?: string;
  providerExecutable?: string;
  supervisedInvocation?: SupervisedManagedInvocation;
  risk: string;
  skillIds?: readonly string[];
  capabilityIds?: readonly string[];
  verificationSuiteIds: readonly string[];
  workforce?: { assignmentId: string; agentId: string; leaseId: string };
  workCausality?: ManagedWorkCausalityInput;
  assignmentFinalization?: "immediate" | "governed";
  roleId?: string;
  linkedEvidenceCanaryAuthorization?: ManagedLinkedEvidenceCanaryAuthorization;
}

export interface ManagedRunOutcome {
  contextQuality?: HostContextOutcomeReport;
  provider: RunProvider;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  projectId: string;
  runId: string;
  sessionId: string;
  resultArtifact: ManagedProviderResultArtifact;
  writingPublication: WritingPublicationResult;
  managedChanges: ManagedFileChangeEvidence[];
  verificationStatus: "passed" | "failed" | "not_run";
  verifications: readonly ManagedProjectVerification[];
  resolvedSkills: readonly ResolvedRunSkill[];
  resolvedCapabilities: readonly ResolvedCapability[];
  activatedCapabilities: readonly AdapterCapabilityActivationReceipt[];
  searchContext: ManagedSearchContextSummary;
}

export interface ManagedRunDependencies {
  resolveOutcomePolicy?: (input: {
    request: ManagedRunRequest;
    result: import("@lervo/execution-contract").ManagedProviderRunResult;
    storage: ProjectStorage;
  }) => Promise<HostOutcomePolicy>;
  openStorage(root: string): Promise<ProjectStorage>;
  createAdapter(input: {
    provider: RunProvider;
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
    structuredOutputSchema?: Record<string, unknown>;
    selectionBoundary?: "read_only_no_tools";
    executable?: string;
  }): ProviderAdapter;
  createId(prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn"): string;
  userSkillRoot?: string;
  userCapabilityRoot?: string;
  semanticEvaluator?: WritingSemanticEvaluator;
  createSemanticEvaluator?: (input: LocalProviderWritingEvaluatorInput) => WritingSemanticEvaluator;
  now?: () => Date;
  createSearchNonce?: () => string;
  prepareVerification?(input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    research?: { inputArtifactHash: string; casRoot: string };
    now?: () => Date;
  }): Promise<PreparedRunVerification>;
  groundProductionRequest?: GroundProductionRequest;
  /** Internal paired-evaluation seam; ordinary application composition leaves this undefined. */
  resolveExperimentalLinkedEvidenceSelection?: typeof resolveDefaultManagedLinkedEvidenceSelection;
}

export type ExecuteManagedRun = (request: ManagedRunRequest) => Promise<ManagedRunOutcome>;

export class ManagedRunCommandError extends Error {
  constructor(
    readonly code: "cleanup_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedRunCommandError";
  }
}
