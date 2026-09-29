# ADR-0353: Bound full runtime verification on busy hosts

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The reviewed background normalization of three Lervo documents reached `normalization_apply` after independent semantic review. Its `repository.default.v4` verification passed lint and type checking, then selected the full Vitest suite because the repository already had 353 changed paths, including 22 opaque runtime triggers. The test command was terminated at its 900-second limit. The apply transaction rolled back with `knowledge_apply_failed`, so repeating the same stage cannot reduce normalization debt.

Version 4 is an immutable evidence definition. Its one-worker, 900-second bound was measured against a much smaller test corpus in ADR-0352; the current full corpus has exceeded that bound even when a prior separate run used two workers.

## Decision

Add `repository.default.v5` with the same lint, typecheck, risk classification, related-test selection, full-suite escalation, and 1 MiB output bound. Its risk-based command uses a separate version-five entrypoint and four Vitest workers. Give that command 1,800 seconds; retain the existing lint and typecheck limits. The version-five plan derives from the frozen version-four policy and fails closed if the expected one-worker argument is absent. It changes only the worker count, preserving every escalation trigger and selected test mode.

Keep version 4 and its existing results unchanged. A background worker may use version 5 only after an exact reviewed delegation binds its new suite ID and hash. A version-five pass proves the tests selected for that repository revision under its recorded command; it does not prove knowledge currency, external service behavior, or a release.

## Verification and limits

The focused version-four and version-five plan suites passed 17 tests. `pnpm quality:check`, `pnpm docs:check` (472 documents), and `pnpm release:completion:check --base b3798091d8d49c3c331e25b1f440e4150adc6e93` passed; the release check reported `intent_pending`. The version-five suite hash is `sha256:24a0e3896e8c611de24568ce85398c4fa919949591d74956a872149d316690a5`.

An installed normalization apply must record a passing version-five verification result before the timeout is considered resolved. Four workers and 1,800 seconds are bounds, not a promise of elapsed time; another timeout remains an explicit failed result.

The risk planner still observes the entire Git worktree. A large dirty workspace therefore runs full tests for every normalization batch even when the batch changes only documentation. Reducing that repeated cost requires a separately reviewed verification-scope design and evidence; this decision only removes the proven impossible 900-second limit while retaining full coverage.

## Responsibility review

`verification-plan-v5.mjs` owns only the pure version-five worker-bound adjustment and delegates risk classes to the frozen version-four plan. The version-five runner owns Git observation, bounded diagnostics, and Vitest process invocation. The suite YAML owns exact command and timeout policy. None of these modules changes provider adapters or canonical knowledge state.

## References

- [ADR-0352](0352-escalate-opaque-runtime-changes.md)
- [Background convergence implementation evidence](../../../evidence/quality/background-knowledge-convergence-implementation.md)
- [Autonomous background knowledge convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
