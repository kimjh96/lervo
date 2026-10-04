# ADR-0214: Bounded Repository Upgrade Orchestration

Status: `accepted`
Date: 2026-08-25

## Context

Installed releases could initialize or migrate individual subsystems, but agents had to discover and compose capability migration, repeated knowledge stages, lint, terminal-runtime reconciliation, and repository Node replacement, making upgrades slow and error-prone. Semantic versions cannot identify rebuilt runtimes: two payloads may share a pre-1.0 version while containing different verified bytes.

## Decision

### Plan and apply

`lervo upgrade` creates one read-only `repository_upgrade` plan bound to:

- Physical repository and project identity.
- Running CLI version and build hash.
- Exact capability and knowledge observations.
- Any registered repository Node plan.

`--apply --approval <plan-id>` first recreates that exact plan. It may then refresh content-bound stale built-in workforce role bindings and execute at most sixteen newly revalidated, generated-only knowledge stages under the approved orchestration policy, followed by knowledge lint. Repeated `--approve-role-binding <operation-id>=<approval-hash>` values may additionally authorize a displayed repository-role operation; the outer plan binds those exact approval coordinates. Every inner stage retains its exact current plan and durable apply contract.

The command automatically:

- Copies byte-preserved loose skills into immutable project capability packages.
- Refreshes stale generated agent and assignment bindings for shipped built-in roles and only repository-role groups carrying exact approvals from the current outer plan, with one canonical event per atomic record transition.
- Refreshes Lervo-generated knowledge and hook runtime bytes.
- Transactionally reconciles a registered repository Node.

It never automatically rewrites user-owned documents, rebinds a repository-defined role without its displayed exact approval, changes provider-owned configuration, grants Codex hook trust, chooses a normalization provider, transitions a legacy singleton, issues credentials, or publishes to a Hub. These stages remain `pending_authority` or blocked with their existing exact approval surface.

### Repository Node

A historical fleet registration whose current project policy disables Hub synchronization does not block generated-only repository migration. The Node stage reports `pending_authority` with `node_sync_policy_disabled`, makes no service or policy mutation, and allows capability, knowledge, terminal-runtime, and lint stages to converge locally. Re-enabling synchronization or retiring the registration remains a separate owner decision.

For a registered Node, the planner reads only the owner-only canonical service definition, extracts absolute executable and config coordinates, and exposes only the config-path digest. SHA-256 and the content-addressed launcher path identify the desired Node payload, so changed builds are replaced even when their semantic version is unchanged. An exact active deployment is current even while its optional Hub is unavailable; the stage reason preserves that observation without claiming runtime readiness. Apply revalidates the service-target hash and config through the existing Node contract, observes three complete or narrowly bounded `offline_ready` snapshots, and commits fleet registration last.

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
- A lint failure prevents successful upgrade completion.

## Consequences

Agents can handle ordinary repository upgrades through one idempotent product command instead of composing subsystem commands. Fresh repositories still start with `lervo init`; release acquisition remains installation-specific. During their first structural materialization, generated AGENTS entrypoints include deterministic instruction and skill routes so loose skills cannot deadlock onboarding before a canonical agent entrypoint exists.

## Verification

CLI tests cover read-only planning, stale approval, exact repository-role approval, source preservation, bounded generated-stage apply, loose-skill migration, lint, pending authority, and the uninitialized-repository boundary. Repository-layout and onboarding regressions cover generated AGENTS routing. Service tests retain coverage of same-version content-addressed upgrade, inactive-predecessor recovery, rollback, complete readiness, and bounded offline upgrade readiness.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Natural-language capability lifecycle](../../execution/orchestration/0212-natural-language-capability-lifecycle.md)
- [Deletable derived state boundary](../storage/0213-deletable-derived-state-boundary.md)
