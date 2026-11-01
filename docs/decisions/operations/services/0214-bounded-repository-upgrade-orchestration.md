# ADR-0214: Bounded Repository Upgrade Orchestration

Status: `accepted`
Date: 2026-08-25

Amended by:

- [ADR-0484](0484-keep-upgrades-exclusive-with-background-knowledge-work.md): apply holds the resident full-cycle admission; scans retry concurrent changes.
- [ADR-0487](0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md): `--apply --safe` plans and applies approval-free upgrades in one window.
- [ADR-0488](0488-point-node-configurations-at-one-current-cli.md): the Node stage maintains the host CLI pointer and migrates pinned configuration paths.
- [ADR-0547](../../knowledge/repository/layout/0547-block-only-layout-overflow-a-write-creates-or-grows.md): the Node stage is ordered after knowledge without depending on it; lint always runs and reports content errors in the receipt.

## Context

Installed releases could initialize or migrate individual subsystems, but agents had to discover and compose capability migration, repeated knowledge stages, lint, terminal-runtime reconciliation, and repository Node replacement. This made upgrades slow and error-prone. Semantic versions cannot identify rebuilt runtimes: two payloads may share a pre-1.0 version but contain different verified bytes.

## Decision

### Plan and apply

`lervo upgrade` creates one read-only `repository_upgrade` plan bound to:

- Physical repository and project identity.
- Running CLI version and build hash.
- Exact capability, terminal integration, and knowledge observations.
- Any registered repository Node plan.

`--apply --approval <plan-id>` first recreates that exact plan. It may then refresh content-bound stale built-in workforce role bindings and execute at most sixteen newly revalidated, generated-only knowledge stages under the approved orchestration policy, followed by knowledge lint. Repeated `--approve-role-binding <operation-id>=<approval-hash>` values may additionally authorize a displayed repository-role operation; the outer plan binds those exact approval coordinates. Every inner stage retains its exact current plan and durable apply contract.

The command automatically:

- Copies byte-preserved loose skills into immutable project capability packages.
- Refreshes stale generated agent and assignment bindings for shipped built-in roles and only repository-role groups carrying exact approvals from the current outer plan, with one canonical event per atomic record transition.
- Refreshes Lervo-generated knowledge and hook runtime bytes.
- Transactionally reconciles a registered repository Node.

It never automatically rewrites user-owned documents, rebinds a repository-defined role without its displayed exact approval, changes provider-owned configuration, grants Codex hook trust, chooses a normalization provider, transitions a legacy singleton, issues credentials, or publishes to a Hub. These stages remain `pending_authority` or blocked with their existing exact approval surface.

### Stage dependencies

The plan publishes `policy.stageDependencies`. Apply follows capabilities, workforce, terminal integration, knowledge, then Node. [ADR-0470](0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) adds `event_writer` after terminal integration and Node, plus an independent `host_service` stage. [ADR-0483](../../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) adds `replica_service` last, after `node`.

| Stage | Requires |
| --- | --- |
| `capabilities` | Nothing |
| `workforce` | Capabilities applied first |
| `terminal_integration` | Nothing |
| `knowledge` | Capabilities applied first |
| `node` | Ordered after knowledge; a blocked knowledge stage does not defer it ([ADR-0547](../../knowledge/repository/layout/0547-block-only-layout-overflow-a-write-creates-or-grows.md)). Knowledge lint runs after it |
| `event_writer` | `terminal_integration` and `node` applied first |
| `host_service` | Nothing |
| `replica_service` | Runs last, after `node`; a stage deferred behind an applying `node` stage is re-observed during apply |

Event writer activation retains ADR-0470's reader-evidence, backup, and exact-plan requirements. A stage deferred behind terminal integration or Node applies only if it becomes ready in the same run; otherwise it is skipped with its blockers. Host service remains independent. The replica service stage retains ADR-0483's applicability, pointer, migration, service replacement, and stale-plan checks. These requirements do not establish installed activation or fleet acceptance.

A blocked stage defers only its dependents. Independent stages still plan and apply under the same exact approval; for example, a generated-only hook runtime refresh applies while unclassified documents block knowledge. The plan lists those stages in `applicableStages` and stays `blocked` until the blocker clears. The blocked stage reports its exact blockers: layout blockers, conflicts, contract issues, or the inner command's error envelope. The receipt records skipped stages and reasons. Apply refuses a blocked plan only when `applicableStages` is empty.

Terminal integration is separate. Only a `ready` plan (generated runtime bytes, no provider-owned hook change) applies automatically. A provider hook change stays `pending_authority` with its exact approval. When the knowledge sub-plan chain reaches terminal integration, preceding knowledge stages are current, and the separate stage reports the terminal work.

### Repository Node

A historical fleet registration whose current project policy disables Hub synchronization does not block generated-only repository migration. The Node stage reports `pending_authority` with `node_sync_policy_disabled`, makes no service or policy mutation, and allows capability, knowledge, terminal-runtime, and lint stages to converge locally. Re-enabling synchronization or retiring the registration remains a separate owner decision.

For a registered Node, the planner reads only the owner-only canonical service definition, extracts absolute executable and config coordinates, and exposes only the config-path digest. SHA-256 and the content-addressed launcher path identify the desired Node payload, so changed builds are replaced even when their semantic version is unchanged. An exact active deployment is current even while its optional Hub is unavailable; the stage reason preserves that observation without claiming runtime readiness. Apply revalidates the service-target hash and config through the existing Node contract, observes three complete or narrowly bounded `offline_ready` snapshots, and commits fleet registration last.

[ADR-0488](0488-point-node-configurations-at-one-current-cli.md) adds the Node configuration's executables to this stage. It points the host's `current` CLI pointer at the running CLI install and rewrites version-specific CLI and Node runtime paths in the configuration to the host pointers, first writing an owner-only `.pre-adr-0488` backup. The plan exposes only field names and hashes. A current deployment with only that work plans `node_config_executables_stale` and leaves the Node service unchanged.

### CLI acquisition

The running CLI coordinates repository migration. Acquisition or global installation remains outside the repository plan: the installation environment owns the package manager, release channel, and host write authority. A natural-language agent upgrade updates the CLI from the user's configured installation source, runs the read-only plan, applies the exact plan, and repeats only after a separately authorized boundary is resolved.

## Privacy and evidence

The plan and receipt are local output. They include repository root, project ID, plan IDs, build hash, stage dispositions, counts, bounded repository-role IDs, versions, contract hashes, approval coordinates, config-path digest, and service-target hash. They exclude role prose and source paths, credentials, provider content, service bodies, prompts, model output, and package-manager tokens.

No new durable wrapper event is emitted. Capability, knowledge, terminal, and Node operations retain their existing canonical events or receipts; a wrapper event would duplicate evidence and could imply completion of a pending stage. `repository_upgrade` output proves only orchestration observations and successfully returned inner receipts. It does not prove CLI acquisition, provider activation, semantic use, Hub availability, or Node readiness unless the corresponding inner contract proves it.

## Failure meaning

- A stale upgrade plan means no stage is applied.
- A generated-only stage that does not converge within sixteen iterations fails without crossing a user-owned boundary.
- `pending_authority` means safe automatic work is complete, but a distinct owner must approve or perform the named action.
- A Node failure retains ADR-0207's transactional rollback and unknown-effect meanings. `offline_ready` is allowed only for fresh `hub_unavailable` observations and is not synchronization evidence.
- Lint content errors are reported in the receipt and do not stop other stages. Only a lint command that cannot produce a report fails the apply.
- A `blocked` result after apply means independent stages may have applied, but the repository is not current. Node reconciliation and knowledge lint still run.

## Consequences

Agents can handle ordinary repository upgrades through one idempotent product command instead of composing subsystem commands. Fresh repositories still start with `lervo init`; release acquisition remains installation-specific. During their first structural materialization, generated AGENTS entrypoints include deterministic instruction and skill routes so loose skills cannot deadlock onboarding before a canonical agent entrypoint exists.

## Verification

CLI tests cover read-only planning, stale approval, exact repository-role approval, source preservation, bounded generated-stage apply, loose-skill migration, lint, pending authority, terminal runtime refresh while knowledge is blocked by unclassified documents, the stage dependency policy, and the uninitialized-repository boundary. Repository-layout and onboarding regressions cover generated AGENTS routing. Service tests retain coverage of same-version content-addressed upgrade, inactive-predecessor recovery, rollback, complete readiness, and bounded offline upgrade readiness.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Natural-language capability lifecycle](../../execution/orchestration/0212-natural-language-capability-lifecycle.md)
- [Deletable derived state boundary](../storage/0213-deletable-derived-state-boundary.md)
