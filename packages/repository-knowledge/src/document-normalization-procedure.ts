const APPLY =
  "Lervo cross-checks the candidate in an independent session before it applies it, and the commit it creates is the undo point";

/**
 * Pending normalization is background work (ADR-0530): the convergence resident generates,
 * independently reviews, and applies it. A turn may advance it on request, never by obligation.
 */
export function documentNormalizationProcedure(pendingCount: number): string {
  const run =
    "lervo knowledge normalize --provider <your provider: claude|codex> --scope all-pending --max-provider-calls 8 --json";
  return `${pendingCount} documents await normalization. Background knowledge convergence normalizes them; no turn needs to. Only when the user asks to normalize now, run \`${run}\`, then apply with \`lervo knowledge normalize --candidate <candidateId> --apply <planId>\`; ${APPLY}.`;
}

/**
 * Review of a candidate the host already generated outside the provider sandbox; the turn never
 * starts a nested provider process.
 */
export function storedNormalizationReviewProcedure(input: {
  pendingCount: number;
  candidateId: string;
  planId: string;
  items: ReadonlyArray<{ sourcePath: string }>;
}): string {
  const sources = input.items
    .slice(0, 16)
    .map((item) => item.sourcePath)
    .join(", ");
  const apply = `lervo knowledge normalize --candidate ${input.candidateId} --apply ${input.planId}`;
  return `${input.pendingCount} documents await normalization, and the host prepared candidate ${input.candidateId} for ${sources}. In this repository-changing turn, whatever its task, run \`${apply}\`; ${APPLY}. If the plan ID changed, use the one \`lervo knowledge normalize --candidate ${input.candidateId} --json\` prints. Do not run \`--provider\`; the host generates candidates.`;
}
