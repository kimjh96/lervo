import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { repositoryInstructionPaths } from "./document-layout.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { repositoryInstructionRouteBlock } from "./instruction-routes.js";
import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import {
  RepositoryKnowledgeError,
  type RepositoryKnowledgePreparedScanOptions,
  type RepositoryKnowledgeScanOptions,
  type RepositorySource,
} from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/;

export interface KnowledgeInstructionBootstrapPlan {
  schemaVersion: 1;
  planKind: "instruction_canonical_bootstrap";
  planId: string;
  operationId: string | null;
  approvalHash: string | null;
  status: "not_applicable" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  policyHash: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  canonical: {
    path: "AGENTS.md";
    state: "missing" | "present";
    afterHash: string | null;
  };
  source: {
    path: "CLAUDE.md";
    state: "missing" | "shared_candidate" | "unresolved_mixed";
    contentHash: string | null;
  };
  disposition: "accept" | "defer";
  blocker: string | null;
  operations: DurableKnowledgeUserFileOperation[];
}

export interface KnowledgeInstructionBootstrapReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "instruction_canonical_adoption";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  approvalHash: string;
  sourceContentHash: string;
  canonicalContentHash: string;
  appliedAt: string;
}

function includedSource(
  sources: RepositorySource[],
  path: "AGENTS.md" | "CLAUDE.md",
): (RepositorySource & { content: string; contentHash: string }) | null {
  const source = sources.find((item) => item.path === path);
  if (source === undefined) return null;
  if (
    source.status !== "included" ||
    source.kind !== "instruction" ||
    source.content === undefined ||
    source.contentHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      `The ${path} bootstrap source is not a safe included instruction.`,
    );
  }
  return source as RepositorySource & { content: string; contentHash: string };
}

function hasProviderImportOrManagedBlock(content: string): boolean {
  return /^@AGENTS\.md\s*$/mu.test(content) || /<!--\s*lervo:(?:begin|end)\s+block=/u.test(content);
}

async function safeFilePresent(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The canonical instruction bootstrap target is not a safe regular file.",
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function routeBlock(sources: RepositorySource[]): string {
  return repositoryInstructionRouteBlock({
    instructions: sources.flatMap((source) =>
      source.status === "included" &&
      source.content !== undefined &&
      source.path.startsWith("docs/instructions/") &&
      source.path.endsWith(".md")
        ? [{ path: source.path, instructionPaths: repositoryInstructionPaths(source.content) }]
        : [],
    ),
    skills: sources.flatMap((source) =>
      source.status === "included" &&
      source.path.startsWith(".agents/skills/") &&
      source.path.endsWith("/SKILL.md")
        ? [{ path: source.path }]
        : [],
    ),
  });
}

function appendBlock(content: string, block: string): string {
  const separator =
    content.length === 0 || content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${separator}${block}`;
}

export function serializableKnowledgeInstructionBootstrapPlan(
  plan: KnowledgeInstructionBootstrapPlan,
): Omit<KnowledgeInstructionBootstrapPlan, "operations"> & {
  operations: Array<Omit<DurableKnowledgeUserFileOperation, "content">>;
} {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function createKnowledgeInstructionBootstrapPlan(input: {
  repositoryRoot: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  preparedScan?: RepositoryKnowledgePreparedScanOptions["preparedScan"];
}): Promise<KnowledgeInstructionBootstrapPlan> {
  const root = resolve(input.repositoryRoot);
  const { policy, scan } = await scanConfiguredRepositoryKnowledge(root, {
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
    ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
  });
  const agents = includedSource(scan.sources, "AGENTS.md");
  const claude = includedSource(scan.sources, "CLAUDE.md");
  const agentsPresent = agents !== null || (await safeFilePresent(resolve(root, "AGENTS.md")));
  const policyHash = sha256(canonicalJson(policy));
  const base = {
    schemaVersion: 1 as const,
    planKind: "instruction_canonical_bootstrap" as const,
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    policyHash,
    coverage: scan.coverage,
  };
  if (agentsPresent || claude === null) {
    const state = {
      ...base,
      operationId: null,
      approvalHash: null,
      status: "not_applicable" as const,
      canonical: {
        path: "AGENTS.md" as const,
        state: agentsPresent ? ("present" as const) : ("missing" as const),
        afterHash: agents?.contentHash ?? null,
      },
      source: {
        path: "CLAUDE.md" as const,
        state: claude === null ? ("missing" as const) : ("shared_candidate" as const),
        contentHash: claude?.contentHash ?? null,
      },
      disposition: "defer" as const,
      blocker: null,
      operations: [],
    };
    return { ...state, planId: stableId("kinstbootplan", state) };
  }
  if (hasProviderImportOrManagedBlock(claude.content)) {
    const state = {
      ...base,
      operationId: null,
      approvalHash: null,
      status: "blocked" as const,
      canonical: { path: "AGENTS.md" as const, state: "missing" as const, afterHash: null },
      source: {
        path: "CLAUDE.md" as const,
        state: "unresolved_mixed" as const,
        contentHash: claude.contentHash,
      },
      disposition: "defer" as const,
      blocker: "claude_source_contains_provider_import_or_managed_blocks",
      operations: [],
    };
    return { ...state, planId: stableId("kinstbootplan", state) };
  }
  const content = appendBlock(claude.content, routeBlock(scan.sources));
  const canonicalHash = sha256(content);
  const operationId = stableId("kinstbootop", {
    projectId: scan.projectId,
    sourcePath: claude.path,
    sourceContentHash: claude.contentHash,
    canonicalPath: "AGENTS.md",
    canonicalHash,
  });
  const operation: DurableKnowledgeUserFileOperation = {
    path: "AGENTS.md",
    action: "create",
    ownership: "user",
    mediaType: "text/markdown",
    content,
    desiredHash: canonicalHash,
  };
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      disposition: "accept",
      source: { path: claude.path, contentHash: claude.contentHash },
      canonical: { path: operation.path, contentHash: canonicalHash },
    }),
  );
  const state = {
    ...base,
    operationId,
    approvalHash,
    status: "review_required" as const,
    canonical: {
      path: "AGENTS.md" as const,
      state: "missing" as const,
      afterHash: canonicalHash,
    },
    source: {
      path: "CLAUDE.md" as const,
      state: "shared_candidate" as const,
      contentHash: claude.contentHash,
    },
    disposition: "accept" as const,
    blocker: null,
    operations: [operation],
  };
  await authorizeCurrentRepositoryDocumentLayout({
    repositoryRoot: root,
    operations: state.operations,
  });
  return { ...state, planId: stableId("kinstbootplan", state) };
}

export async function applyKnowledgeInstructionBootstrapPlan(input: {
  plan: KnowledgeInstructionBootstrapPlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: KnowledgeInstructionBootstrapReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeInstructionBootstrapReceipt> {
  if (
    input.plan.status !== "review_required" ||
    input.plan.operationId === null ||
    input.plan.approvalHash === null ||
    input.approvedOperationId !== input.plan.operationId ||
    !HASH.test(input.approvedHash) ||
    input.approvedHash !== input.plan.approvalHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Canonical instruction adoption requires the exact operation ID and approval hash.",
    );
  }
  const current = await createKnowledgeInstructionBootstrapPlan({
    repositoryRoot: input.plan.repositoryRoot,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId || current.status !== "review_required") {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The canonical instruction source, target, routes, policy, or repository snapshot changed.",
    );
  }
  const receipt: KnowledgeInstructionBootstrapReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "instruction_canonical_adoption",
    planId: current.planId,
    operationId: current.operationId!,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    approvalHash: current.approvalHash!,
    sourceContentHash: current.source.contentHash!,
    canonicalContentHash: current.canonical.afterHash!,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
