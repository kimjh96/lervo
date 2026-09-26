/** The bounded normalization batch a repository-changing agent turn performs. */
export function documentNormalizationProcedure(pendingCount: number): string {
  const run =
    "lervo knowledge normalize --provider <your provider: claude|codex> --scope all-pending --max-provider-calls 8 --json";
  return `${pendingCount} documents await normalization. In every repository-changing turn, whatever its task, run \`${run}\`, compare each candidate with its source for preserved meaning, links and lifecycle lines, then rerun the same command with \`--apply <planId>\` and one \`--approve-item <operationId>=<approvalHash>\` per accepted candidate. Leave a candidate that loses meaning unapproved and report it; later turns continue until none remain.`;
}
