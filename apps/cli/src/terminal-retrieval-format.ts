import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import type { SearchQueryProjection } from "@lervo/search";
import type { KnowledgeQueryHit } from "@lervo/repository-knowledge";

import { formatTerminalAttentionContext } from "./operating-attention-format.js";
import { terminalPublicationInstruction } from "./terminal-publication-instruction.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";

export function formatRetrievedTerminalPreamble(input: {
  provider: string;
  observationId: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  workstreamPresent: boolean;
  publicationLanguage: string;
  grounding: { status: string; reasons: string[] };
  durableInstruction: { status: string; reasonIds: string[] };
  queryProjection: SearchQueryProjection;
  attention: OperatingAttentionReportV1;
  selection: {
    disposition: string;
    candidates: readonly KnowledgeQueryHit[];
    selected: readonly KnowledgeQueryHit[];
    retrievalPlanId: string | null;
    retrievalPlanTransitionId: string | null;
    sourceSnapshotId: string;
  };
}): string {
  const finalizationInstruction =
    input.workspaceBinding?.executionKind === "worker"
      ? [
          `This direct provider turn is ${input.workspaceBinding.attachmentDisposition ?? "attached"} on worker workspace ${input.workspaceBinding.workspaceId} generation ${input.workspaceBinding.workspaceGeneration}; provider execution remains unmanaged, while checkout ownership, checkpointed pause, and Stop isolation are evidence-bound.`,
          "Change only assignment-scoped paths. Worker Stop rechecks the ownership marker, writer session, assignment lease, exact workspace revision, and path-scoped diff, then records a workspace checkpoint. It does not advance the repository-wide workstream or repair knowledge movement owned by another workspace.",
          "Commit only when the task or sealing flow requires it; Lervo never invents or silently commits unfinished bytes.",
        ].join("\n\n")
      : terminalDeclarationInstruction(input.provider, input.observationId);
  const workstreamInstruction =
    input.workspaceBinding?.executionKind === "worker"
      ? "The repository-wide current workstream is informational for this worker. Do not advance it as worker completion bookkeeping."
      : !input.workstreamPresent
        ? "If this turn changes repository-authored bytes, the agent must create a bounded checkpoint before completion with `lervo workstream start --actor agent --provider <current-provider> --stdin --apply-now`. A read-only inquiry does not create artificial continuation state. The user must not be asked to run bookkeeping commands."
        : "If this turn changes repository-authored bytes, the agent must record the next bounded revision before completion with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD and preserves identity and origin. Replace stale facts instead of accumulating prose, and do not ask the user to run bookkeeping commands. A read-only inquiry does not advance the workstream.";
  return [
    "Lervo terminal integration v2 used a provider-neutral query projection only for read-only candidate retrieval in the current repository. It did not resolve effects, authority, execution, external systems, or cross-repository routing.",
    terminalPublicationInstruction(input.publicationLanguage),
    `effectGroundingStatus: ${input.grounding.status}; workflowId: none; reasons: ${input.grounding.reasons.join(",")}`,
    `selectionDisposition: ${input.selection.disposition}; candidates: ${input.selection.candidates.length}; selected: ${input.selection.selected.length}`,
    `retrievalPlanId: ${input.selection.retrievalPlanId ?? "baseline"}; transition: ${input.selection.retrievalPlanTransitionId ?? "none"}`,
    `queryProjectionStatus: ${input.queryProjection.receipt.status}; queries: ${input.queryProjection.receipt.projectedQueryCount}; receipt: ${input.queryProjection.receipt.receiptId}`,
    `sourceSnapshotId: ${input.selection.sourceSnapshotId}`,
    "This search covers only registered knowledge in the current repository. An empty or failed result is not evidence that content is absent from another repository or any external or shared service. Inspect those surfaces through their available tools and configured authority independently.",
    "The following exact-hash publications were loaded and prepared for return through the provider hook. This proves hook-side preparation, not provider acceptance, managed delivery, understanding, or later use.",
    "Use current repository bytes as authority, follow AGENTS.md, and do not treat a recommendation as semantic truth.",
    `durableInstructionStatus: ${input.durableInstruction.status}; ruleId: none; targetPath: none; reasons: ${input.durableInstruction.reasonIds.join(",")}. Direct prompt preparation never materializes a repository rule. When the user explicitly adds a repository-long instruction, perform agent bookkeeping through \`lervo knowledge instruction intake --provider ${input.provider} --stdin\` with the exact request in {schemaVersion:1,request}; inspect the returned Markdown and candidate hash, then use \`lervo knowledge instruction review\` with the exact apply or reject decision. Never infer durability or approval, and never ask the user to run these commands.`,
    formatTerminalAttentionContext(input.attention),
    "If the final response explicitly relies on a supplied publication, append its exact Lervo evidence marker as a standalone Markdown HTML comment. Keep the marker out of prose and code. Markdown renderers hide the comment, while raw output retains verifiable evidence. A marker proves only an output reference, never understanding or internal use.",
    finalizationInstruction,
    workstreamInstruction,
  ].join("\n\n");
}

export function terminalDeclarationInstruction(provider: string, observationId: string): string {
  return `For a repository-changing turn, finish repository verification, the final commit or repository-byte change, workstream advancement, and knowledge refresh first. Declare last with \`lervo terminal declare --provider ${provider} --observation ${observationId} --stdin\`; any later repository-authored byte change or commit makes that declaration stale. The stdin JSON fields are: taskMode=change|review|continuation|approval_response; canonicalizationDisposition=canonical_sources_current|canonical_sources_updated|pending_user_approval; canonicalizationOutcome as one exact v1 object; knowledgeDisposition=current|refreshed|pending_user_approval; deliberationDisposition=not_requested|completed|no_consensus|failed; deliberationId=null unless bound to a completed Lervo deliberation. The outcome must bind every changed noncanonical source path exactly once: use kind=canonical_update with summary and targets[{path,contentHash,sourcePaths}] when canonical bytes changed; kind=no_durable_change with summary, reasonCode=implementation_only|verification_only|already_canonical|transient, and sourcePaths when review should reject durable promotion; kind=review_draft with summary and drafts[{targetPath,sourcePaths,proposedMarkdown,proposedContentHash}] when exact Markdown review is required; or kind=portable_skill_candidate with summary, sourcePaths, and a bounded development-pattern proposal only when at least two independent groups bind distinct current passed verification events plus exact source, skill, resource, input, output, tool, and permission contracts. Retrieval selection and provider agreement never satisfy that gate. This declaration is an unmanaged agent claim checked against repository, knowledge, workstream, verification, and deliberation evidence; proposal bodies remain local candidate state and are not event content or truth. This is agent bookkeeping; never ask the user to run it. A read-only turn needs no declaration.`;
}
