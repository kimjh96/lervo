const REVIEW =
  "compare each output in the candidate artifact with its source for preserved meaning, links and lifecycle lines";

/**
 * Pending normalization is background work (ADR-0530): the convergence resident generates,
 * independently reviews, and applies it. A turn may advance it on request, never by obligation.
 */
export function documentNormalizationProcedure(pendingCount: number): string {
  const run =
    "lervo knowledge normalize --provider <your provider: claude|codex> --scope all-pending --max-provider-calls 8 --json";
  return `${pendingCount} documents await normalization. Background knowledge convergence normalizes them; no turn needs to. Only when the user asks to normalize now, run \`${run}\`, ${REVIEW}, then apply with \`lervo knowledge normalize --candidate <candidateId> --apply <planId>\` and one \`--approve-item <operationId>=<approvalHash>\` per accepted candidate.`;
}

/**
 * Review of a candidate the host already generated outside the provider sandbox; the turn never
 * starts a nested provider process.
 */
export function storedNormalizationReviewProcedure(input: {
  pendingCount: number;
  candidateId: string;
  planId: string;
  items: ReadonlyArray<{ sourcePath: string; operationId: string; approvalHash: string }>;
}): string {
  const approvals = input.items
    .slice(0, 16)
    .map((item) => `--approve-item ${item.operationId}=${item.approvalHash}`)
    .join(" ");
  const sources = input.items
    .slice(0, 16)
    .map((item) => item.sourcePath)
    .join(", ");
  const review = `lervo knowledge normalize --candidate ${input.candidateId} --json`;
  const apply = `lervo knowledge normalize --candidate ${input.candidateId} --apply ${input.planId} ${approvals}`;
  return `${input.pendingCount} documents await normalization, and the host prepared candidate ${input.candidateId} for ${sources}. In this repository-changing turn, whatever its task, run \`${review}\`, ${REVIEW}, then run \`${apply}\`, omitting the approval of any output that loses meaning and reporting it. If the plan ID changed, use the one the review printed. Do not run \`--provider\`; the host generates candidates.`;
}
