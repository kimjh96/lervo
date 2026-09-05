import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { captureRepositorySnapshot, type RepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import type { SearchQueryProjectionReceipt } from "@lervo/search";
import {
  canonicalJson,
  formatWorkstreamContext,
  listCanonicalizationCandidates,
  scanConfiguredRepositoryKnowledge,
  sha256,
  type KnowledgeQueryHit,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { createCurrentWorkstreamSearchProjectionContext } from "./search-projection-context.js";
import { assembleTerminalHookContext } from "./terminal-context-assembly.js";
import { loadSelectedTerminalDocument } from "./terminal-context-loading.js";
import { selectTerminalContextCandidates } from "./terminal-context-selection.js";
import { inspectTerminalInstructionCatalog } from "./terminal-durable-instruction.js";
import { formatTerminalAttentionContext } from "./operating-attention-format.js";
import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import { readTerminalKnowledgeLifecycleCache } from "./terminal-knowledge-lifecycle-cache.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";
import type { CliServices } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

const MAXIMUM_CONTEXT_BYTES = 28 * 1024;
const MAXIMUM_DOCUMENT_CONTEXT_BYTES = 12 * 1024;
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
  additionalContext: string;
  sourceSnapshotId: string;
  recommendationCount: number;
  documents: PreparedTerminalDocument[];
  repositoryRevision: string;
  repositoryFiles: RepositorySnapshot["files"];
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

function evidenceMarker(
  document: Pick<PreparedTerminalDocument, "conceptId" | "contentHash">,
): string {
  return `<!-- lervo-ref:${document.conceptId}:${document.contentHash} -->`;
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
  const {
    supplementalSources,
    instructionCatalog,
    currentWorkstream,
    canonicalization,
    projectId,
    preparedKnowledge,
  } = await input.timing.measure("corpus_preparation", async () => {
    const supplementalSources = await collectLocalKnowledgeSources(input.root);
    const workstreamStorage = await openProjectStorage(input.root);
    try {
      const [preparedKnowledge, currentWorkstream, canonicalization] = await Promise.all([
        scanConfiguredRepositoryKnowledge(input.root, { supplementalSources }),
        verifiedCurrentWorkstream(workstreamStorage),
        listCanonicalizationCandidates(input.root).then(
          (candidates) => ({ coverage: "complete" as const, candidates }),
          () => ({ coverage: "unavailable" as const, candidates: [] }),
        ),
      ]);
      const instructionCatalog = await inspectTerminalInstructionCatalog({
        repositoryRoot: input.root,
        supplementalSources,
        preparedKnowledge,
      });
      return {
        supplementalSources,
        instructionCatalog,
        currentWorkstream,
        canonicalization,
        projectId: workstreamStorage.manifest.projectId,
        preparedKnowledge,
      };
    } finally {
      await workstreamStorage.close();
    }
  });
  const searchProjectionContext =
    currentWorkstream === null
      ? { context: { contextRequirement: "none" }, contextAnchors: [] }
      : createCurrentWorkstreamSearchProjectionContext(currentWorkstream);
  const requestDigest = sha256(input.prompt);
  const [queryProjection, repositorySnapshot] = await Promise.all([
    input.timing.measure("query_projection", () =>
      input.services.projectSearchQueries({
        request: input.prompt,
        requestDigest,
        context: searchProjectionContext.context,
        contextDigest: sha256(canonicalJson(searchProjectionContext.context)),
        contextAnchors: searchProjectionContext.contextAnchors,
        requestedLanguage: instructionCatalog.semanticCatalog.retrievalLanguage,
        provider: input.provider,
      }),
    ),
    input.timing.measure("repository_snapshot", () => captureRepositorySnapshot(input.root)),
  ]);
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
  const cachedLifecycleIssues = await readTerminalKnowledgeLifecycleCache({
    root: input.root,
    repositoryRevision: repositorySnapshot.revision,
    supplementalSources,
  });
  const attention = createOperatingAttentionReport({
    projectId,
    workstream: currentWorkstream,
    canonicalization,
    knowledgeLifecycle:
      cachedLifecycleIssues === null
        ? { coverage: "unavailable", issues: [] }
        : { coverage: "cached", issues: cachedLifecycleIssues },
    observedAt: new Date(),
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
            const full = formatWorkstreamContext(currentWorkstream);
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
    const finalizationInstruction =
      input.workspaceBinding?.executionKind === "worker"
        ? [
            `This direct provider turn is ${input.workspaceBinding.attachmentDisposition ?? "attached"} on worker workspace ${input.workspaceBinding.workspaceId} generation ${input.workspaceBinding.workspaceGeneration}; provider execution remains unmanaged, while checkout ownership, checkpointed pause, and Stop isolation are evidence-bound.`,
            "Change only assignment-scoped paths. Worker Stop rechecks the ownership marker, writer session, assignment lease, exact workspace revision, and path-scoped diff, then records a workspace checkpoint. It does not advance the repository-wide workstream or repair knowledge movement owned by another workspace.",
            "Commit only when the task or sealing flow requires it; Lervo never invents or silently commits unfinished bytes.",
          ].join("\n\n")
        : `For a repository-changing turn, finish repository verification, the final commit or repository-byte change, workstream advancement, and knowledge refresh first. Declare last with \`lervo terminal declare --provider ${input.provider} --observation ${input.observationId} --stdin\`; any later repository-authored byte change or commit makes that declaration stale. The stdin JSON fields are: taskMode=change|review|continuation|approval_response; canonicalizationDisposition=canonical_sources_current|canonical_sources_updated|pending_user_approval; canonicalizationOutcome as one exact v1 object; knowledgeDisposition=current|refreshed|pending_user_approval; deliberationDisposition=not_requested|completed|no_consensus|failed; deliberationId=null unless bound to a completed Lervo deliberation. The outcome must bind every changed noncanonical source path exactly once: use kind=canonical_update with summary and targets[{path,contentHash,sourcePaths}] when canonical bytes changed; kind=no_durable_change with summary, reasonCode=implementation_only|verification_only|already_canonical|transient, and sourcePaths when review should reject durable promotion; kind=review_draft with summary and drafts[{targetPath,sourcePaths,proposedMarkdown,proposedContentHash}] when exact Markdown review is required; or kind=portable_skill_candidate with summary, sourcePaths, and a bounded development-pattern proposal only when at least two independent groups bind distinct current passed verification events plus exact source, skill, resource, input, output, tool, and permission contracts. Retrieval selection and provider agreement never satisfy that gate. This declaration is an unmanaged agent claim checked against repository, knowledge, workstream, verification, and deliberation evidence; proposal bodies remain local candidate state and are not event content or truth. This is agent bookkeeping; never ask the user to run it. A read-only turn needs no declaration.`;
    const workstreamInstruction =
      input.workspaceBinding?.executionKind === "worker"
        ? "The repository-wide current workstream is informational for this worker. Do not advance it as worker completion bookkeeping."
        : workstream === null
          ? "If this turn changes repository-authored bytes, the agent must create a bounded checkpoint through the `lervo workstream start --actor agent --provider <current-provider>` plan/apply flow before completion. A read-only inquiry does not create artificial continuation state. The user must not be asked to run bookkeeping commands."
          : "If this turn changes repository-authored bytes, the agent must record the next bounded revision through the `lervo workstream update --actor agent --provider <current-provider>` plan/apply flow before completion. Preserve identity and origin, replace stale facts instead of accumulating prose, and do not ask the user to run bookkeeping commands. A read-only inquiry does not advance the workstream.";
    const preamble = [
      "Lervo terminal integration v2 used a provider-neutral query projection only for read-only candidate retrieval in the current repository. It did not resolve effects, authority, execution, external systems, or cross-repository routing.",
      `effectGroundingStatus: ${grounding.status}; workflowId: none; reasons: ${grounding.reasons.join(",")}`,
      `selectionDisposition: ${selection.disposition}; candidates: ${selection.candidates.length}; selected: ${selection.selected.length}`,
      `retrievalPlanId: ${selection.retrievalPlanId ?? "baseline"}; transition: ${selection.retrievalPlanTransitionId ?? "none"}`,
      `queryProjectionStatus: ${queryProjection.receipt.status}; queries: ${queryProjection.receipt.projectedQueryCount}; receipt: ${queryProjection.receipt.receiptId}`,
      `sourceSnapshotId: ${selection.sourceSnapshotId}`,
      "This search covers only registered knowledge in the current repository. An empty or failed result is not evidence that content is absent from another repository or any external or shared service. Inspect those surfaces through their available tools and configured authority independently.",
      "The following exact-hash publications were loaded and prepared for return through the provider hook. This proves hook-side preparation, not provider acceptance, managed delivery, understanding, or later use.",
      "Use current repository bytes as authority, follow AGENTS.md, and do not treat a recommendation as semantic truth.",
      `durableInstructionStatus: ${durableInstruction.status}; ruleId: none; targetPath: none; reasons: ${durableInstruction.reasonIds.join(",")}. Direct prompt preparation never materializes a repository rule; use the repository's explicit instruction lifecycle for durable changes.`,
      formatTerminalAttentionContext(attention),
      "If the final response explicitly relies on a supplied publication, append its exact Lervo evidence marker as a standalone Markdown HTML comment. Keep the marker out of prose and code. Markdown renderers hide the comment, while raw output retains verifiable evidence. A marker proves only an output reference, never understanding or internal use.",
      finalizationInstruction,
      workstreamInstruction,
    ].join("\n\n");
    const sections: string[] = [];
    const documents: PreparedTerminalDocument[] = [];
    let usedBytes =
      Buffer.byteLength(preamble) +
      (workstream === null ? 0 : Buffer.byteLength("\n\n") + workstream.deliveredByteCount);
    for (const hit of selection.selected) {
      const sectionPrefix = [
        `## ${hit.path}`,
        `Lervo recommendation: score=${hit.score}; freshness=${hit.freshness}; assurance=${hit.assurance}; contentHash=${hit.contentHash}`,
        `Lervo evidence marker: ${evidenceMarker(hit)}`,
        "",
      ].join("\n");
      const separatorBytes = Buffer.byteLength("\n\n");
      const availableBytes =
        MAXIMUM_CONTEXT_BYTES - usedBytes - separatorBytes - Buffer.byteLength(sectionPrefix);
      const content = await input.timing.measureChild("exact_loading", "context_assembly", () =>
        loadSelectedTerminalDocument({
          repositoryRoot: input.root,
          hit,
          maximumBytes: Math.min(availableBytes, MAXIMUM_DOCUMENT_CONTEXT_BYTES),
        }),
      );
      if (content === null) continue;
      const section = `${sectionPrefix}${content.content}`;
      sections.push(section);
      documents.push({
        conceptId: hit.conceptId,
        path: hit.path,
        contentHash: hit.contentHash,
        scope: content.scope,
        deliveredByteCount: Buffer.byteLength(content.content),
        assurance: hit.assurance,
        freshness: hit.freshness,
      });
      usedBytes += separatorBytes + Buffer.byteLength(section);
      if (MAXIMUM_CONTEXT_BYTES - usedBytes <= 512) break;
    }
    const fallback =
      selection.disposition === "query_projection_missing"
        ? "No current-repository publication was selected because query projection was unavailable. This says nothing about other repositories or external surfaces. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes."
        : selection.disposition === "no_candidates"
          ? "No registered publication in the current repository matched the validated query projection. This says nothing about other repositories or external surfaces. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes."
          : "Selected publications could not be exact-hash loaded. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes.";
    const additionalContext = assembleTerminalHookContext({
      preamble,
      workstreamContext: workstream?.context ?? null,
      documentSections: sections,
      fallback,
      maximumBytes: MAXIMUM_CONTEXT_BYTES,
    });
    return { additionalContext, documents, workstream };
  });
  return {
    additionalContext: assembled.additionalContext,
    sourceSnapshotId: selection.sourceSnapshotId,
    recommendationCount: selection.candidates.length,
    documents: assembled.documents,
    repositoryRevision: repositorySnapshot.revision,
    repositoryFiles: repositorySnapshot.files,
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
