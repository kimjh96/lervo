import type { ContextQualityPreparationResult } from "@lervo/repository-context";
import { prepareTerminalEvidence } from "./terminal-evidence-context.js";
import { prepareTerminalInstructionPreamble } from "./terminal-instruction-context.js";
import { observeContextPreparation } from "@lervo/context";
import type { ContextPreparationReport } from "@lervo/schemas";
import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import type { RepositorySnapshot } from "@lervo/orchestrator";
import type { SearchQueryProjectionReceipt } from "@lervo/search";
import {
  canonicalJson,
  formatWorkstreamContext,
  sha256,
  workstreamFreshnessPolicy,
  type KnowledgeQueryHit,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { assembleTerminalHookContext } from "./terminal-context-assembly.js";
import { selectTerminalContextCandidates } from "./terminal-context-selection.js";
import { prepareCompactTerminalPromptContext } from "./terminal-compact-context.js";
import { readDocumentFreshnessAttention } from "./document-freshness-attention.js";
import { readInstructionCaptureAttention } from "./instruction-capture-attention.js";
import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import { readTerminalKnowledgeLifecycleCacheEntry } from "./terminal-knowledge-lifecycle-cache.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import { prepareTerminalPromptInputs } from "./terminal-prompt-preparation.js";
import {
  formatRetrievedTerminalPreamble,
  terminalDeclarationInstruction,
} from "./terminal-retrieval-format.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";
import type { CliServices } from "./types.js";
import { observeWorkstreamFreshness } from "./workstream-repository-head.js";

const MAXIMUM_CONTEXT_BYTES = 28 * 1024;
const MAXIMUM_WORKSTREAM_CONTEXT_BYTES = 8 * 1024;
const TRUNCATION_NOTICE = "\n[Lervo content truncated]";

export interface PreparedTerminalDocument {
  conceptId: string;
  path: string;
  contentHash: string;
  scope: "full" | "prefix";
  deliveredByteCount: number;
  assurance: KnowledgeQueryHit["assurance"];
  freshness: KnowledgeQueryHit["freshness"];
}

export interface PreparedTerminalPromptContext {
  preparationQuality: ContextPreparationReport;
  quality?: ContextQualityPreparationResult;
  additionalContext: string;
  sourceSnapshotId: string;
  recommendationCount: number;
  documents: PreparedTerminalDocument[];
  selectedPointers?: {
    path: string;
    contentHash: string;
    kind: "skill" | "decision" | "instruction";
  }[];
  repositoryRevision: string;
  repositoryFiles: RepositorySnapshot["files"];
  repositoryCommits?: RepositorySnapshot["commits"];
  workstream: {
    workstreamId: string;
    revision: number;
    snapshotHash: string;
    scope: "full" | "prefix";
    deliveredByteCount: number;
    context: string;
  } | null;
  attention: OperatingAttentionReportV1;
  grounding: {
    requestDigest: string;
    queryDigest: string;
    status: "ready" | "clarify" | "abstain" | "approval_required";
    workflowId: string | null;
    sourceClasses: string[];
    subjectIds: string[];
    retrievalQueries: string[];
    providerIds: string[];
    reasons: string[];
    queryProjectionReceipt: SearchQueryProjectionReceipt;
  };
  durableInstruction: {
    status: "ignored" | "workstream" | "current" | "pending" | "applied" | "blocked";
    ruleId: string | null;
    targetPath: string | null;
    reasonIds: string[];
  };
  selection: {
    disposition: "query_projection_missing" | "no_candidates" | "selected";
    selectedCount: number;
  };
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

export async function prepareTerminalPromptContext(input: {
  root: string;
  prompt: string;
  provider: TerminalIntegrationProvider;
  observationId: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  services: Pick<CliServices, "projectSearchQueries">;
  timing: TerminalStageObservationPort;
}): Promise<PreparedTerminalPromptContext> {
  if (terminalPromptContextMode() === "compact")
    return prepareCompactTerminalPromptContext({
      ...input,
      declarationInstruction: terminalDeclarationInstruction(input.provider, input.observationId),
    });
  const {
    supplementalSources,
    instructionCatalog,
    currentWorkstream,
    canonicalization,
    projectId,
    preparedKnowledge,
    requestDigest,
    queryProjection,
    repositorySnapshot,
  } = await prepareTerminalPromptInputs(input);
  const grounding = {
    status: "abstain" as const,
    workflowId: null,
    sourceClasses: [] as string[],
    subjectIds: [] as string[],
    retrievalQueries: [] as string[],
    providerIds: [] as string[],
    reasons: ["unmanaged_terminal_retrieval_only"],
  };
  const durableInstruction = {
    status: "ignored" as const,
    ruleId: null,
    targetPath: null,
    reasonIds: ["unmanaged_terminal_retrieval_only"],
  };
  const cachedLifecycle = await readTerminalKnowledgeLifecycleCacheEntry({
    root: input.root,
    repositoryRevision: repositorySnapshot.revision,
    supplementalSources,
  });
  const observedAt = new Date();
  const workstreamFreshness =
    currentWorkstream === null
      ? null
      : await observeWorkstreamFreshness({
          root: input.root,
          snapshot: currentWorkstream,
          policy: workstreamFreshnessPolicy(preparedKnowledge.policy),
          observedAt,
        });
  const attention = createOperatingAttentionReport({
    projectId,
    workstream: currentWorkstream,
    workstreamFreshness,
    canonicalization,
    knowledgeLifecycle:
      cachedLifecycle === null
        ? { coverage: "unavailable", issues: [] }
        : {
            coverage: "cached",
            issues: [...cachedLifecycle.issues, ...cachedLifecycle.advisories],
          },
    documentFreshness: await readDocumentFreshnessAttention(input.root, observedAt),
    instructionCapture: await readInstructionCaptureAttention(input.root),
    observedAt,
  });
  const selection = await input.timing.measure("search", () =>
    selectTerminalContextCandidates({
      repositoryRoot: input.root,
      projectId,
      provider: input.provider,
      projection: queryProjection,
      retrievalQueries: queryProjection.queries,
      sourceSnapshotId: instructionCatalog.sourceSnapshotId,
      supplementalSources,
      preparedScan: preparedKnowledge.scan,
    }),
  );
  const assembled = await input.timing.measure("context_assembly", async () => {
    const workstream =
      currentWorkstream === null
        ? null
        : (() => {
            const full = formatWorkstreamContext(currentWorkstream, workstreamFreshness);
            const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE);
            const context =
              Buffer.byteLength(full) <= MAXIMUM_WORKSTREAM_CONTEXT_BYTES
                ? full
                : `${truncateUtf8(full, MAXIMUM_WORKSTREAM_CONTEXT_BYTES - noticeBytes)}${TRUNCATION_NOTICE}`;
            return {
              workstreamId: currentWorkstream.workstreamId,
              revision: currentWorkstream.revision,
              snapshotHash: sha256(`${canonicalJson(currentWorkstream)}\n`),
              scope: context === full ? ("full" as const) : ("prefix" as const),
              deliveredByteCount: Buffer.byteLength(context),
              context,
            };
          })();
    const basePreamble = formatRetrievedTerminalPreamble({
      provider: input.provider,
      observationId: input.observationId,
      workspaceBinding: input.workspaceBinding,
      workstreamPresent: workstream !== null,
      publicationLanguage: preparedKnowledge.policy.publication.language,
      grounding,
      durableInstruction,
      queryProjection,
      attention,
      selection,
    });
    const instructions = await prepareTerminalInstructionPreamble({
      root: input.root,
      preamble: basePreamble,
      maximumBytes: MAXIMUM_CONTEXT_BYTES - MAXIMUM_WORKSTREAM_CONTEXT_BYTES - 1024,
      prompt: input.prompt,
      sourceSnapshotId: selection.sourceSnapshotId,
    });
    const preamble = instructions.preamble;
    const preparedEvidence = await prepareTerminalEvidence({
      root: input.root,
      prompt: input.prompt,
      instructionMaximumBytes: instructions.report.preparedByteCount,
      instructionCatalogDigest: instructions.report.catalogDigest,
      remainingBytes:
        MAXIMUM_CONTEXT_BYTES -
        Buffer.byteLength(preamble) -
        (workstream === null ? 0 : Buffer.byteLength("\n\n") + workstream.deliveredByteCount),
      selection,
      projectorBuildId: queryProjection.receipt.projector.buildId,
      projectedQueries: queryProjection.queries,
    });
    const fallback =
      selection.disposition === "query_projection_missing"
        ? "No current-repository publication was selected because query projection was unavailable. This says nothing about other repositories or external surfaces. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes."
        : selection.disposition === "no_candidates"
          ? "No registered publication in the current repository matched the validated query projection. This says nothing about other repositories or external surfaces. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes."
          : "Selected publications could not be exact-hash loaded. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes.";
    const additionalContext = assembleTerminalHookContext({
      preamble,
      workstreamContext: workstream?.context ?? null,
      documentSections: preparedEvidence.sections,
      fallback,
      maximumBytes: MAXIMUM_CONTEXT_BYTES,
    });
    return {
      additionalContext,
      documents: preparedEvidence.documents,
      workstream,
      loads: preparedEvidence.loads,
      quality: preparedEvidence.quality,
      instructions: instructions.report,
    };
  });
  return {
    quality: assembled.quality,
    preparationQuality: {
      ...observeContextPreparation({
        requestDigest,
        sourceSnapshotId: selection.sourceSnapshotId,
        retrieval:
          selection.disposition === "query_projection_missing" ? "unavailable" : "completed",
        candidateCount:
          selection.disposition === "query_projection_missing" ? null : selection.candidates.length,
        selected: selection.selected.map((hit) => ({
          sourceId: hit.conceptId,
          contentHash: hit.contentHash,
        })),
        loads: assembled.loads,
      }),
      instructions: assembled.instructions,
    },
    additionalContext: assembled.additionalContext,
    sourceSnapshotId: selection.sourceSnapshotId,
    recommendationCount: selection.candidates.length,
    documents: assembled.documents,
    repositoryRevision: repositorySnapshot.revision,
    repositoryFiles: repositorySnapshot.files,
    ...(repositorySnapshot.commits === undefined
      ? {}
      : { repositoryCommits: repositorySnapshot.commits }),
    workstream: assembled.workstream,
    attention,
    grounding: {
      requestDigest,
      queryDigest: queryProjection.receipt.projectedQueryDigest,
      status: grounding.status,
      workflowId: grounding.workflowId,
      sourceClasses: grounding.sourceClasses,
      subjectIds: grounding.subjectIds,
      retrievalQueries: grounding.retrievalQueries,
      providerIds: grounding.providerIds,
      reasons: grounding.reasons,
      queryProjectionReceipt: queryProjection.receipt,
    },
    durableInstruction,
    selection: {
      disposition: selection.disposition,
      selectedCount: selection.selected.length,
    },
  };
}

/** Prompt context stays compact unless a developer opts into per-prompt retrieval. */
function terminalPromptContextMode(): "compact" | "retrieval" {
  return process.env.LERVO_TERMINAL_CONTEXT === "retrieval" ? "retrieval" : "compact";
}
