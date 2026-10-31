import {
  documentDriftAttentionIssues,
  documentNormalizationProcedure,
} from "@lervo/repository-knowledge";
import {
  createKnowledgeInstructionBootstrapPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  assertNoKnowledgeMaterializationTransaction,
  RepositoryKnowledgeError,
  scanConfiguredRepositoryKnowledge,
  type KnowledgeMaterializationSettlement,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { terminalHookKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { documentRouteDeferralAdvisories } from "./document-route-deferral-attention.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";
import {
  readTerminalKnowledgeLifecycleCacheEntry,
  writeTerminalKnowledgeLifecycleCache,
  type TerminalKnowledgeLifecycleCacheEntry,
} from "./terminal-knowledge-lifecycle-cache.js";

type LifecycleIssue = TerminalLifecycleInspection["issues"][number];

/** Few enough that drift never crowds lifecycle gates out of the twelve-item prompt context. */
const TERMINAL_DRIFT_ATTENTION_ITEMS = 4;

const TRANSIENT_INSPECTION_FAILURES = new Set([
  "instruction_canonical_bootstrap_failed",
  "repository_layout_inspection_failed",
  "repository_knowledge_inspection_failed",
  "claude_instruction_bridge_inspection_failed",
  "repository_knowledge_lint_inspection_failed",
  "document_normalization_inspection_failed",
]);

function lifecycleFailure(input: {
  code: string;
  command: string;
  error: unknown;
}): LifecycleIssue {
  return {
    code: input.code,
    command: input.command,
    ...(input.error instanceof RepositoryKnowledgeError
      ? {
          detail:
            input.error.publicDiagnostic === undefined
              ? input.error.code
              : `${input.error.publicDiagnostic.code}: ${input.error.publicDiagnostic.message}`,
        }
      : {}),
  };
}

function sharedScan(scan: RepositoryKnowledgeScan | undefined) {
  return scan === undefined ? {} : { preparedScan: scan };
}

async function inspectStructuralLifecycle(input: {
  root: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedScan: RepositoryKnowledgeScan | undefined;
}): Promise<{ issues: LifecycleIssue[]; advisories: LifecycleIssue[] }> {
  const issues: LifecycleIssue[] = [];
  let instructionBootstrapStatus:
    Awaited<ReturnType<typeof createKnowledgeInstructionBootstrapPlan>>["status"] | null = null;
  try {
    const instructionBootstrap = await createKnowledgeInstructionBootstrapPlan({
      repositoryRoot: input.root,
      supplementalSources: input.supplementalSources,
      ...sharedScan(input.preparedScan),
    });
    instructionBootstrapStatus = instructionBootstrap.status;
  } catch (error) {
    issues.push(
      lifecycleFailure({
        code: "instruction_canonical_bootstrap_failed",
        command: "lervo migrate knowledge",
        error,
      }),
    );
  }
  if (instructionBootstrapStatus !== null && instructionBootstrapStatus !== "not_applicable") {
    issues.push({
      code: `instruction_canonical_bootstrap_${instructionBootstrapStatus}`,
      command: "lervo migrate knowledge",
    });
  }

  let layout: Awaited<ReturnType<typeof createRepositoryLayoutMigrationPlan>> | null = null;
  if (instructionBootstrapStatus === "not_applicable") {
    try {
      layout = await createRepositoryLayoutMigrationPlan({
        repositoryRoot: input.root,
        supplementalSources: input.supplementalSources,
        ...sharedScan(input.preparedScan),
      });
    } catch (error) {
      issues.push(
        lifecycleFailure({
          code: "repository_layout_inspection_failed",
          command: "lervo migrate knowledge",
          error,
        }),
      );
    }
  }
  if (layout !== null && layout.status !== "current") {
    issues.push({ code: `repository_layout_${layout.status}`, command: "lervo migrate knowledge" });
  }
  // ADR-0476: a document waiting for a semantic route is attention, never a lifecycle gate.
  const advisories =
    layout === null ? [] : documentRouteDeferralAdvisories(layout.deferredDocuments);

  let structuralCurrent = false;
  if (layout?.status === "current") {
    try {
      const structural = await createKnowledgeMigrationPlan({
        repositoryRoot: input.root,
        mode: "migrate",
        supplementalSources: input.supplementalSources,
        ...sharedScan(input.preparedScan),
      });
      structuralCurrent = structural.operations.every((item) => item.action === "unchanged");
      if (!structuralCurrent) {
        issues.push({
          code: `repository_knowledge_${structural.status}`,
          command: "lervo migrate knowledge",
        });
      }
    } catch (error) {
      issues.push(
        lifecycleFailure({
          code: "repository_knowledge_inspection_failed",
          command: "lervo migrate knowledge",
          error,
        }),
      );
    }
  }

  if (structuralCurrent) {
    try {
      const bridge = await createKnowledgeInstructionBridgePlan({
        repositoryRoot: input.root,
        provider: "claude",
        supplementalSources: input.supplementalSources,
        ...sharedScan(input.preparedScan),
      });
      if (bridge.status !== "current") {
        issues.push({
          code: `claude_instruction_bridge_${bridge.status}`,
          command: "lervo migrate knowledge",
        });
      }
    } catch (error) {
      issues.push(
        lifecycleFailure({
          code: "claude_instruction_bridge_inspection_failed",
          command: "lervo migrate knowledge",
          error,
        }),
      );
    }
  }
  return { issues, advisories };
}

async function inspectValidationLifecycle(input: {
  root: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedScan: RepositoryKnowledgeScan | undefined;
}): Promise<TerminalKnowledgeLifecycleCacheEntry> {
  const lintIssues: LifecycleIssue[] = [];
  let advisories: LifecycleIssue[] = [];
  let normalization: Awaited<ReturnType<typeof inspectConfiguredDocumentNormalization>> | undefined;
  let normalizationError: unknown;
  try {
    normalization = await inspectConfiguredDocumentNormalization({
      repositoryRoot: input.root,
      supplementalSources: input.supplementalSources,
      ...sharedScan(input.preparedScan),
    });
  } catch (error) {
    normalizationError = error;
  }

  try {
    const lint = await lintRepositoryKnowledge(input.root, {
      supplementalSources: input.supplementalSources,
      ...sharedScan(input.preparedScan),
      ...(normalization === undefined ? {} : { preparedNormalization: normalization }),
    });
    // Drift warnings are agent-owned attention, never lifecycle gates (ADR-0464).
    advisories = documentDriftAttentionIssues(lint, TERMINAL_DRIFT_ATTENTION_ITEMS);
    if (lint.coverage !== "complete" || !lint.valid) {
      lintIssues.push({
        code: "repository_knowledge_lint_failed",
        command: "lervo knowledge lint",
      });
    }
  } catch (error) {
    lintIssues.push(
      lifecycleFailure({
        code: "repository_knowledge_lint_inspection_failed",
        command: "lervo knowledge lint",
        error,
      }),
    );
  }

  if (normalization !== undefined) {
    if (normalization.pendingDocuments.length > 0) {
      lintIssues.push({
        code: "document_normalization_pending",
        // Agent-owned in every repository-changing turn, whatever its task, so the debt never
        // waits for a user to notice it: one bounded batch per turn until none remain.
        command: documentNormalizationProcedure(normalization.pendingDocuments.length),
      });
    }
  } else {
    lintIssues.push(
      lifecycleFailure({
        code: "document_normalization_inspection_failed",
        command: "lervo migrate knowledge --provider codex",
        error: normalizationError,
      }),
    );
  }
  return { issues: lintIssues, advisories };
}

interface TerminalRepositoryKnowledgeInput {
  root: string;
  repositoryRevision: string;
  supplementalSources: RepositorySupplementalSource[];
  /** Defaults to the hook-bounded wait; foreground commands pass their own settlement. */
  materialization?: KnowledgeMaterializationSettlement | undefined;
}

/** Lifecycle gates only; drift advisories never block a turn, declaration, or checkpoint. */
export async function inspectTerminalRepositoryKnowledgeLifecycle(
  input: TerminalRepositoryKnowledgeInput,
): Promise<LifecycleIssue[]> {
  return (await inspectTerminalRepositoryKnowledge(input)).issues;
}

/** Lifecycle gates plus bounded, agent-owned document drift advisories for attention. */
export async function inspectTerminalRepositoryKnowledge(
  input: TerminalRepositoryKnowledgeInput,
): Promise<TerminalKnowledgeLifecycleCacheEntry> {
  await (input.materialization ?? terminalHookKnowledgeMaterializationSettlement(input.root)).run(
    () => assertNoKnowledgeMaterializationTransaction({ repositoryRoot: input.root }),
  );
  const cached = await readTerminalKnowledgeLifecycleCacheEntry(input);
  if (cached !== null) return cached;
  const preparedScan = await scanConfiguredRepositoryKnowledge(input.root, {
    supplementalSources: input.supplementalSources,
  })
    .then(({ scan }) => scan)
    .catch(() => undefined);
  const [structuralIssues, validationIssues] = await Promise.all([
    inspectStructuralLifecycle({
      root: input.root,
      supplementalSources: input.supplementalSources,
      preparedScan,
    }),
    inspectValidationLifecycle({
      root: input.root,
      supplementalSources: input.supplementalSources,
      preparedScan,
    }),
  ]);
  const issues = [...structuralIssues.issues, ...validationIssues.issues];
  const advisories = [...structuralIssues.advisories, ...validationIssues.advisories];
  if (
    preparedScan !== undefined &&
    !issues.some((issue) => TRANSIENT_INSPECTION_FAILURES.has(issue.code))
  ) {
    const confirmedRevision = await captureTerminalRepositorySnapshot(input.root)
      .then((snapshot) => snapshot.revision)
      .catch(() => null);
    if (confirmedRevision === input.repositoryRevision) {
      await writeTerminalKnowledgeLifecycleCache({ ...input, issues, advisories }).catch(
        () => undefined,
      );
    }
  }
  return { issues, advisories };
}
