# ADR-0214: Bounded Repository Upgrade Orchestration

Status: `accepted`
Date: 2026-08-25

## Context

An installed Lervo release could initialize or migrate each subsystem, but an agent had to discover and compose capability migration, repeated knowledge stages, lint, terminal-runtime reconciliation, and repository Node replacement. This made upgrades slow and error-prone. Semantic versions also cannot identify rebuilt runtimes: two payloads may share a pre-1.0 version while containing different verified bytes.

## Decision

`lervo upgrade` creates one read-only `repository_upgrade` plan bound to:

- the physical repository;
- project identity;
- the running CLI version and build hash;
- exact capability and knowledge observations; and
- any registered repository Node plan.

`--apply --approval <plan-id>` first recreates that exact plan. It may then execute at most sixteen newly revalidated, generated-only knowledge stages under the approved orchestration policy, followed by knowledge lint. Every inner stage retains its exact current plan and durable apply contract.

The command automatically:

- copies byte-preserved loose skills into immutable project capability packages;
- refreshes Lervo-generated knowledge and hook runtime bytes; and
- transactionally reconciles a registered repository Node.

It never automatically rewrites user-owned documents, changes provider-owned configuration, grants Codex hook trust, chooses a normalization provider, transitions a legacy singleton, issues credentials, or publishes to a Hub. Those stages remain `pending_authority` with their existing exact approval surface.

A historical fleet registration whose current project policy disables Hub synchronization does not block generated-only repository migration. The Node stage reports `pending_authority` with `node_sync_policy_disabled`, performs no service or policy mutation, and allows capability, knowledge, terminal-runtime, and lint stages to converge locally. Re-enabling synchronization or retiring that registration remains a separate owner decision.

For a registered Node, the planner reads only the owner-only canonical service definition, extracts the absolute executable and config coordinates, and exposes only the config-path digest. SHA-256 and the content-addressed launcher path identify the desired Node payload, so a changed build is replaced even if its semantic version is unchanged. An exact active deployment is current even while its optional Hub is unavailable; the stage reason preserves that observation without claiming runtime readiness. Apply revalidates the service-target hash and config through the existing Node contract, observes three complete or narrowly bounded `offline_ready` snapshots, and commits fleet registration last.

The already running CLI coordinates repository migration. Acquiring or globally installing that CLI remains outside the repository plan because the package manager, release channel, and host write authority belong to the installation environment. A natural-language agent upgrade therefore updates the CLI from the user's configured installation source, runs the read-only plan, applies the exact plan, and repeats only after a separately authorized boundary is resolved.

## Privacy and evidence

The plan and receipt are local output. They include the repository root, project ID, plan IDs, build hash, stage dispositions, counts, config-path digest, and service-target hash. They exclude credentials, provider content, service bodies, prompts, model output, and package-manager tokens.

No new durable wrapper event is emitted. Capability, knowledge, terminal, and Node operations retain their existing canonical events or receipts; a wrapper event would duplicate evidence and could imply completion of a pending stage. `repository_upgrade` output proves only orchestration observations and successfully returned inner receipts. It does not prove CLI acquisition, provider activation, semantic use, Hub availability, or Node readiness unless the corresponding inner contract proves it.

## Failure meaning

- A stale upgrade plan means no stage is applied.
- A generated-only stage that does not converge within sixteen iterations fails without crossing a user-owned boundary.
- `pending_authority` means safe automatic work is complete, but a distinct owner must approve or perform the named action.
- A Node failure retains the transactional rollback and unknown-effect meanings of ADR-0207. `offline_ready` is allowed only for fresh `hub_unavailable` observations and is not synchronization evidence.
- A lint failure prevents successful upgrade completion.

## Consequences

Agents can handle ordinary repository upgrades through one idempotent product command instead of composing subsystem commands manually. Fresh repositories still start with `lervo init`; release acquisition remains installation-specific. During their first structural materialization, generated AGENTS entrypoints include deterministic instruction and skill routes so loose skills cannot deadlock onboarding before a canonical agent entrypoint exists.

## Verification

CLI tests cover read-only planning, stale approval, bounded generated-stage apply, loose-skill migration, lint, pending authority, and the uninitialized-repository boundary. Repository-layout and onboarding regressions cover generated AGENTS routing. Service tests retain coverage of same-version content-addressed upgrade, inactive-predecessor recovery, rollback, complete readiness, and bounded offline upgrade readiness.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Natural-language capability lifecycle](../../execution/orchestration/0212-natural-language-capability-lifecycle.md)
- [Deletable derived state boundary](../storage/0213-deletable-derived-state-boundary.md)
