/**
 * Tokens charged against a supervision token budget. A cached input read costs a tenth of an
 * uncached input token, and each provider turn re-reads the whole cached context, so counting it
 * in full exhausted worker budgets after a few turns of nearly free re-reads. Recorded usage keeps
 * the raw provider counters; only budget enforcement uses this cost-equivalent total.
 */
export const CACHED_INPUT_BUDGET_DIVISOR = 10;

export function budgetTokens(usage: { totalTokens: number; cachedInputTokens?: number }): number {
  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.totalTokens);
  return usage.totalTokens - cached + Math.ceil(cached / CACHED_INPUT_BUDGET_DIVISOR);
}
