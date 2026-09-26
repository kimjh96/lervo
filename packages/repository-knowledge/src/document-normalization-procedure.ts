const REVIEW =
  "compare each output in the candidate artifact with its source for preserved meaning, links and lifecycle lines";

/** The bounded normalization batch a repository-changing terminal turn performs. */
export function documentNormalizationProcedure(pendingCount: number): string {
  const run =
    "lervo knowledge normalize --provider <your provider: claude|codex> --scope all-pending --max-provider-calls 8 --json";
  return `${pendingCount} documents await normalization. In every repository-changing turn, whatever its task, run \`${run}\`, ${REVIEW}, then apply with \`lervo knowledge normalize --candidate <candidateId> --apply <planId>\` and one \`--approve-item <operationId>=<approvalHash>\` per accepted candidate. Leave a candidate that loses meaning unapproved and report it; later turns continue until none remain.`;
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
