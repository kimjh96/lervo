# Bounded document layout and rewrite ownership

Status: `completed`

As of: 2026-08-26

## Objective

Implement [ADR-0222](../../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md) so every repository document writer shares one projected-capacity, scoped-role, and rewrite-owner contract without assuming a universal root layout or specific formatting product.

## Delivery order

1. Define the version-2 document-policy schema, finite defaults, compatibility reader, and reviewed upgrade plan.
2. Implement the pure projected-layout evaluator, content-bound permit, durable-apply enforcement, ownership-aware counts, and typed blockers.
3. Replace root-role branches with scoped policy roles and provider-surface descriptors.
4. Route migration, normalization, structure commands, entrypoint creation, managed routes, development-pattern promotion, generated publication, lint, and apply revalidation through the evaluator.
5. Add rewrite capability descriptors, byte-owner lifecycle fields, bounded managed-configuration projections, and adapter contract tests.
6. Implement Prettier as one adapter fixture, then prove a second structurally different rewriter adapter so the core contract cannot depend on Prettier semantics.
7. Upgrade Lervo and one external repository, refresh knowledge, and complete clean-clone acceptance.

## Completion criteria

- Every included Markdown and MDX file contributes to finite repository and direct-directory capacity calculations, independent of path naming.
- Every child directory containing included documents contributes to its parent's finite capacity.
- Plans evaluate creates, moves, splits, deletes, and generated replacements against the projected after-state; apply and lint use the same evaluator.
- No document-writing command can publish without a current policy evaluation.
- The common durable-apply boundary rejects every Markdown or MDX mutation without an exact current document-layout permit, including operations from a newly added command fixture.
- Capacity overflow never creates mechanical buckets, catch-all routes, or recursive normalization families.
- Existing v1 repositories receive a content-bound upgrade plan and cannot indefinitely remain in compatibility mode while reporting migration current.
- Human and continuation roles are repository-scoped policy data. Provider-standard paths remain confined to provider descriptors and are exposed to core as provider-neutral roles.
- Lervo-generated projections declare maximum output, depth, replacement, and pruning behavior.
- Lifecycle records identify byte ownership and rewrite policy. Registered rewriters either honor a bounded managed exclusion or prove content-bound idempotence.
- Unknown or bypassed rewriters remain `unmanaged`; no compatibility or delivery claim is emitted.
- Managed tool configuration preserves all user-owned bytes and fails closed on unsafe patterns, negation conflicts, excessive rules, stale configuration, or unsupported behavior.
- Common tests cover at least two rewrite adapters, direct-directory and child-directory overflow, projected move and split overflow, role conflicts, legacy upgrade, concurrent source change, interruption rollback, and idempotent rerun.
- Direct Prettier invocation, the repository wrapper, and editor-compatible ignore behavior agree for the Prettier fixture without a repository-wide Markdown exclusion.
- `pnpm quality:check`, relevant repository-knowledge suites, document lifecycle checks, `lervo migrate knowledge`, and `lervo knowledge lint` pass on Lervo and the external fixture.

## Current rewrite baseline

Observed on 2026-08-26:

- `pnpm exec vitest run scripts/test/format-ownership.test.mjs` passed all three ownership tests.
- `pnpm format:check` passed through the repository wrapper.
- `pnpm exec prettier --check .` reported 39 Markdown files whose bytes it would change.

This proves the current Prettier adapter protects the repository-owned command path but not direct tool or editor paths. It does not establish a general rewrite-ownership contract and therefore does not close this roadmap.

## Non-claims

Passing an adapter contract does not prove that a user invoked the registered tool or that an editor respected repository configuration. Unobserved rewrites remain unmanaged, and later byte changes are detected as lifecycle staleness.

## Completion evidence

Completed on 2026-08-26:

- The tracked document policy is schema version 2 with researched defaults of 32 direct documents, 32 document-bearing children, 4,096 repository documents, and 12 family outputs. Compatibility loading and exact v1-to-v2 migration are covered by repository-layout tests.
- `@lervo/documents` owns the pure projected-tree evaluator, content-bound permit, rewrite descriptor evaluation, managed-ignore projection, and content-bound dry-run contract. It has no provider, Orca, Hub, or tool-product dependency.
- Repository planning, lint, and durable apply use the common evaluator. The durable boundary rejects a Markdown or MDX mutation without a current permit and revalidates snapshot, policy, roles, operation set, counts, and expiry before mutation.
- Scoped repository roles live in tracked policy. Exact `AGENTS.md` and `CLAUDE.md` paths live in Codex and Claude provider-surface descriptors and enter core as neutral role IDs.
- Active normalization records are schema version 2 and declare `reviewer` plus `reviewed_exact`. This phase originally projected lifecycle ownership into `.prettierignore`; ADR-0303 later replaced that tracked adapter projection with the neutral registry.
- The ownership-aware wrapper and content-bound adapters protect the same bytes. Formatter, autofix, transform, and generator capabilities pass the common neutral contract without adding tool identifiers to canonical policy.
- The external-repository fixture exercises a root overview, an MDX guide in a non-Lervo layout, both adapter forms, permit issuance, and capacity failure. Pure evaluator tests cover direct-file, child-directory, move, create, repository-total, override, role, tamper, and expiry cases; durable tests cover missing permit, interruption recovery, rollback, and event failure.
- Lervo self-migration upgraded 262 legacy lifecycle records and refreshed all affected structural projections in one durable transaction. `lervo knowledge lint` then passed with 271 concepts and no issues.
