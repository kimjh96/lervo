# ADR-0529: Remove the semantic compilation pipeline

Status: `accepted`
Decision date: 2026-10-24

## Context

The semantic pipeline had five manual steps:

1. `lervo knowledge compile` asked an isolated provider for concepts, claims, and relations.
2. `compare`, `stability`, `merge-candidate`, and `fuzzy-merge-candidate` compared and merged two providers' candidates.
3. `reconcile` and `review-policy` prepared a review.
4. `review` recorded per-item approvals.
5. `materialize <review-id>` wrote claim and relation sidecars and generated semantic pages.

None of these steps ever ran in practice. The WSL Hub holds the events of all 10 Lervo repositories, and on 2026-10-24 it showed:

- 3,400 `knowledge.materialization.applied` events, none with the `semantic` operation.
- No knowledge review or compilation records.

Background convergence never invoked the pipeline. The only consumer of its relations, the reviewed relation context, was removed by [ADR-0523](../../search/activation/0523-retire-reviewed-relation-context.md) because it never received a relation.

The pipeline spanned 13 repository-knowledge modules, about 3,600 lines, plus three CLI command modules. Its provider adapter shared one file with the no-capability JSON runner and the document normalizer.

## Decision

Remove the semantic compilation pipeline:

- The 13 `packages/repository-knowledge` modules: semantic compiler, materialization, reconciliation and review, cross-provider exact and fuzzy merge, comparison, stability, binding, the candidate store, validation, signatures, and user patch.
- The `compile`, `compare`, `stability`, `merge-candidate`, `fuzzy-merge-candidate`, `reconcile`, `review-policy`, and `review` subcommands. Also `materialize <review-id>`.
- `createProcessSemanticCompiler`, its response schema and instruction, and the unstructured Claude response path that only it used. The shared runner now always requires native structured output from Claude.
- The `pilot:knowledge-compilation` script.

Keep the following:

- `lervo knowledge materialize --recover`. It recovers every interrupted knowledge materialization, and recovery messages name it.
- Claim and relation sidecar formats and readers. Lint, query assurance, and OKF exchange still read them.
- The no-capability JSON runner and the document normalizer. Their options type is renamed to `CreateProcessProviderOptions`, and the shared telemetry type is now named `NoCapabilityTelemetry`.

The no-capability boundary keeps its tests through the JSON runner: an empty working directory with every model tool disabled, rejection of a Codex tool event, rejection of a Claude response that reports server tool use, and prompt termination on cancellation.

## Consequences

The CLI loses eight advertised subcommands and the review-ID form of `materialize`. Existing claim and relation sidecars, if any, stay valid and readable. No repository has any.

A future semantic knowledge path must show demand first. It should enter through background convergence, with a reviewed design, rather than as manual commands.

## Verification

- `pnpm typecheck`, `pnpm repository-scripts:check`, `pnpm code-convention:check`, and `pnpm docs:check` pass.
- Repository-knowledge, repository-knowledge-compiler, and CLI tests pass without the semantic cases. The no-capability boundary tests listed above pass through the JSON runner.
