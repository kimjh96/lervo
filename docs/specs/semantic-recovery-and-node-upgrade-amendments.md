# Current clarification of semantic recovery and Node upgrade amendments

Status: `active`
As of: 2026-10-07

This document reconciles the supplied ADRs. It distinguishes current requirements from historical incidents and does not establish installed acceptance.

## Semantic review preparation

[ADR-0490](../decisions/knowledge/semantics/0490-regenerate-stale-semantic-candidates-before-the-pre-stage-check.md) supplies the ordering that [ADR-0486](../decisions/knowledge/semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) explicitly left unverified in its evidence limits.

The provider-neutral owner calls optional `prepareStage(stage, input)` before its pre-stage currency check. A non-null result settles the stage without running it. Otherwise the owner performs the check and calls `runStage`. Post-stage input and currency checks apply to both paths.

The runtime uses preparation for ADR-0486's bounded regeneration: stale bound context on a canonical or normalization review returns that review to its producing stage, at most three times per obligation. Other source drift still fails the pre-stage check. No new event, state, or failure code is introduced; regeneration retains the `review_context_regenerated` receipt.

The triggering observation was digimon's 03:20:16 UTC requeue on 2026-10-07 under runtime `41465145`: it settled again with `review_context_stale` after 0.18 seconds, without an assignment or evidence hash and without a regeneration count. Regeneration inside `runStage` was unreachable because `host.assertCurrent(state)` failed first.

Required verification includes an owner-level regression that fails under the previous ordering, preparation returning null for current context, stale-context regeneration, and rejection of stale state followed by acceptance of regenerated state. Digimon leaving the installed stall remains required evidence; the supplied source does not report that success.

## Tool-generated opaque files and role resolution

[ADR-0491](../decisions/knowledge/semantics/0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md) amends ADR-0473 tool ownership and ADR-0479 asset settlement.

Package-manager ownership is `generator_configuration` evidence with `generator: "package_manager"`. A lockfile must have a `package.json` beside it. That package declares its manager through `packageManager`, or inherits the nearest ancestor package's declaration when its own declaration is absent. Only the declared manager's outputs qualify:

| Manager | Lockfiles                                  |
| ------- | ------------------------------------------ |
| npm     | `package-lock.json`, `npm-shrinkwrap.json` |
| pnpm    | `pnpm-lock.yaml`                           |
| yarn    | `yarn.lock`                                |
| bun     | `bun.lock`, `bun.lockb`                    |

A filename alone, another manager's lockfile, or a lockfile without an adjacent package manifest proves no ownership. The evidence records only the manager name and declaring package path.

At final verification, opaque sources with any ADR-0473 tool-ownership evidence count as `assetSettlement.toolGenerated`. They need no asset declaration, and declarations do not bind them. This does not grant semantic or visual approval. Other opaque sources retain their applicable typed declaration or exact captured-revision suite-binding requirements, and pinned verification is never bypassed.

The same-scope rebind removes tool-generated declarations from both inline `assetDispositions` and the asset manifest. Ordinary plan/apply updates `assetDispositionManifestHash`. Every other declaration retains its exact content and order, and every scope coordinate remains unchanged. A working-tree manifest differing from its committed version only by these removals is settled Lervo output; the next batch-boundary commit records it so integration workspaces and repository verification read the cleaned manifest. Changes to non-tool-generated declarations do not qualify. Existing materialization and `knowledge.convergence.delegation.continued` (`rebound`) events record the cleanup.

Shiflo's failed asset-integrity suite remains valid failure evidence. Pinning its declared Bun manager's lockfiles was the Lervo design gap; manual lockfile repinning is not current acceptance. Required acceptance is automatic owner-host rebind followed by passing pinned verification and departure from `knowledge_verification_failed`. No supplied evidence establishes that recovery.

Role resolution is memoized by the canonical digest of exact repository role sources, with at most 16 registries and private clones for every caller. Built-in identity checks use a precomputed set; changed sources force resolution under a new digest. Tests must establish independent clones and invalidation. The source reports a local resolution reduction from about 2.1 ms to 0.47 ms. Its WSL profile observed 12.8 seconds in role resolution within 43.5 seconds of main-thread busy time during a 120-second profile. A lower installed CPU share remains an acceptance requirement, not a measured outcome in the supplied evidence.

## Upgrade orchestration and guarded Node configuration changes

[ADR-0214](../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md) retains exact identity and build binding, byte-preserved capability migration, exact role approvals, at most sixteen revalidated generated-only knowledge stages, lint, and transactional Node reconciliation. Its stage dependencies include ADR-0470's event writer and independent host service, and ADR-0483's final replica service stage. Blocked stages defer their dependents; independent applicable stages may still run. Provider configuration, user-owned documents, repository-role approval, credentials, legacy transitions, and publication retain their separate authority boundaries. CLI acquisition remains outside the repository plan.

[ADR-0484](../decisions/operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) places apply inside host full-cycle admission. [ADR-0487](../decisions/operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) permits `--apply --safe` to plan inside that window, refuse any pending owner authority before effects, and otherwise apply generated-only safe stages. Admission does not freeze user edits, replica changes, or other writers outside resident full cycles. Inner revalidation, marker settlement, and bounded scan retries remain required. Exact outer-plan refusal before apply means nothing was applied; a later stage failure does not undo or negate earlier successful stages.

[ADR-0488](../decisions/operations/services/0488-point-node-configurations-at-one-current-cli.md) retains the host-local absolute `runtimes/cli/current` link to the installed package root, atomic pointer replacement, regular `dist/bin.js` validation, and the running installed CLI as its target. A source-level runtime reports `not_installed` and moves nothing. Configuration planning reports hashes and field names, recognizes known CLI installs throughout raw JSON strings and argument lists, preserves explicit overrides, and migrates Node runtime pins only when their pointer exists. Startup and status retain configured-executable diagnostics. Old-install pruning remains deferred pending an exact reference-aware plan.

[ADR-0489](../decisions/operations/services/0489-migrate-node-configurations-only-inside-the-service-transition.md) supersedes ADR-0488's in-place configuration replacement and its instruction to keep migrated configuration after replacement failure. It also clarifies ADR-0214's claim that configuration-only work leaves the service unchanged: the service definition may remain identical, but the service restarts.

The Node stage rechecks observations, updates the CLI pointer, validates rewritten paths, preserves the owner-only content-bound backup, and writes candidate bytes to a private temporary file. It passes that file as `--configuration-source`; it does not overwrite the running Node's configuration. The service transition freezes admission under the running configuration digest, stops the Node, replaces configuration and frozen binding together, and starts the replacement. A failed replacement restores original configuration bytes and binding with the previous definition. A configuration-only change uses the same guarded restart; an identical definition without a configuration transition remains a conflict.

Accepted migration differences are string leaves rewritten through `/runtimes/cli/current/` or `/runtimes/node/current/`, resolving to regular user-owned files that group and others cannot write. Other differences remain refused. Already migrated hosts recover only through qualifying owner-only, single-link `.pre-adr-0488-<12 hex>` backups whose names bind their content and whose changes satisfy those migration restrictions. Recovery freezes under a matching predecessor digest and transitions the binding to the current configuration without rewriting already migrated bytes. Restoration reverses the binding and restores predecessor bytes. A concurrent requested replacement during recovery is refused.

An unexplained digest mismatch reports `service_upgrade_config_mismatch` before stopping the service. Missing or conflicting admission sessions retain `service_upgrade_fence_invalid`; active work and an owned upgrade retain `service_upgrade_work_busy`. A requested configuration transition without an installed service reports `node_fleet_config_transition_unavailable`.

ADR-0488's final statement that no installed host had migrated is historical to that document's original observation. ADR-0489 subsequently records in-place migrations and retained backups on WSL, with axli, flemo, and plen failing the fence. That evidence proves neither successful guarded recovery nor current fleet readiness. Completion requires the corresponding inner service, readiness, and recovery receipts; orchestration output alone is insufficient.
