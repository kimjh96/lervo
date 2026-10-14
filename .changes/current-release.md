<!-- lervo-release package="@lervo/cli" version="0.22.2" schema="1" -->

## What's changed

- Give new knowledge evaluation logic one attempt on a convergence assignment that exhausted its retries under earlier logic, so a deploy can recover a stalled integration.
- Judge knowledge convergence verification on the bytes Git keeps, so a suite that writes ignored build output such as tsbuildinfo or Husky hooks no longer fails as modifying sources.
- Retire failed, cancelled, superseded, and settled knowledge convergence checkouts on every host, and let state prune skip their worktrees, so convergence no longer accumulates gigabytes of stranded worktrees.
- Scope knowledge provider batch budgets to the evaluation logic, so a deploy can reevaluate a stage whose budget an earlier run spent, including on cancelled calls.
