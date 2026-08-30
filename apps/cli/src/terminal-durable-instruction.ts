import {
  applyDurableInstructionPlan,
  createDurableInstructionPlan,
  durableInstructionCatalogEntry,
  scanConfiguredRepositoryKnowledge,
  type GroundedDurableInstruction,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

export interface TerminalInstructionCatalog {
  complete: boolean;
  sourceSnapshotId: string;
  semanticCatalog: {
    schemaVersion: 1;
    retrievalLanguage: string;
    canonicalInstructions: {
      complete: boolean;
      entries: Array<{ path: string; contentHash: string; excerpt: string }>;
    };
  };
}

export interface TerminalDurableInstructionReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "durable_instruction_intake";
  planId: string;
  projectId: string;
  ruleId: string | null;
  targetPath: string | null;
  requestDigest: string;
  resolverResultDigest: string;
  appliedAt: string;
}

export interface TerminalDurableInstructionResult {
  status: "ignored" | "workstream" | "current" | "pending" | "applied" | "blocked";
  ruleId: string | null;
  targetPath: string | null;
  reasonIds: string[];
}

export async function inspectTerminalInstructionCatalog(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
}): Promise<TerminalInstructionCatalog> {
  const { policy, scan } = await scanConfiguredRepositoryKnowledge(input.repositoryRoot, {
    supplementalSources: input.supplementalSources,
  });
  const sources = scan.sources
    .filter(
      (source) =>
        source.status === "included" &&
        source.content !== undefined &&
        (source.path === "AGENTS.md" || source.path.startsWith("docs/instructions/")),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const complete = sources.length <= 32;
  return {
    complete,
    sourceSnapshotId: scan.snapshotId,
    semanticCatalog: {
      schemaVersion: 1,
      retrievalLanguage: policy.publication.language,
      canonicalInstructions: {
        complete,
        entries: sources
          .slice(0, 32)
          .map((source) =>
            durableInstructionCatalogEntry({ path: source.path, content: source.content! }),
          ),
      },
    },
  };
}

export async function materializeTerminalDurableInstruction(input: {
  repositoryRoot: string;
  projectId: string;
  requestDigest: string;
  resolverResultDigest: string;
  groundingStatus: "ready" | "clarify" | "abstain" | "approval_required";
  ambiguityReasons: string[];
  catalogComplete: boolean;
  instruction: GroundedDurableInstruction;
  workerWorkspace: boolean;
  now: Date;
  recordApplied: (receipt: TerminalDurableInstructionReceipt) => void | Promise<void>;
}): Promise<TerminalDurableInstructionResult> {
  const plan = await createDurableInstructionPlan({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    requestDigest: input.requestDigest,
    resolverResultDigest: input.resolverResultDigest,
    groundingStatus: input.groundingStatus,
    catalogComplete: input.catalogComplete,
    ambiguityReasons: input.ambiguityReasons,
    instruction: input.instruction,
  });
  const reasonIds = [...plan.reasonIds];
  if (plan.status !== "ready") {
    return {
      status: plan.status,
      ruleId: plan.ruleId,
      targetPath: plan.targetPath,
      reasonIds,
    };
  }
  if (input.workerWorkspace) {
    return {
      status: "pending",
      ruleId: plan.ruleId,
      targetPath: plan.targetPath,
      reasonIds: [...reasonIds, "worker_workspace_cannot_write_repository_rule"],
    };
  }
  const receipt: TerminalDurableInstructionReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "durable_instruction_intake",
    planId: plan.planId,
    projectId: input.projectId,
    ruleId: plan.ruleId,
    targetPath: plan.targetPath,
    requestDigest: plan.requestDigest,
    resolverResultDigest: plan.resolverResultDigest,
    appliedAt: input.now.toISOString(),
  };
  await applyDurableInstructionPlan({
    plan,
    receipt,
    recordApplied: input.recordApplied,
  });
  return {
    status: "applied",
    ruleId: plan.ruleId,
    targetPath: plan.targetPath,
    reasonIds,
  };
}
