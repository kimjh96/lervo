<!-- lervo-release package="@lervo/cli" version="0.21.0" schema="1" -->

## What's changed

- Accept a repository Node replacement whose only non-ready components keep their exact pre-upgrade state, extend readiness while startup progresses, and name the blocking component when readiness or recovery fails.
- Accept terminal hook runtimes up to 8 MiB so lervo upgrade no longer blocks terminal integration with runtime_invalid.
- Admit every knowledge resident: lervo upgrade activates event schema 4 with a backup and installs one host resident service; held residents report their cause; refused Hub coordinates never grant ownership; drifted bindings rebind.
- Carry delegation-bound verification suites, repository roles, and asset manifests across hosts through the Hub, so a host that lacks them installs the exact reviewed bytes and seeds a peer's delegation instead of reporting delegation_missing.
- Install and verify the complete SDK dependency closure for fleet Node runtimes so conversation replies survive upgrades.
- Keep an atomic current Node runtime pointer, run the replica coordinator and its peer commands through it, refuse mixed capture semantics, and reject unknown replica config keys.
- Keep background convergence moving after deploy: bind generated projections by hash in lifecycle plan review, move a squash-absorbed knowledge integration ref to the base with a backup and an event, and report verification suites that rewrite tracked files with their exact paths.
- Keep background knowledge continuous on every host: same-scope delegation renewal under a host policy, cross-host delegation seeding, derived Hub owner-host configuration, honest upgrade status, and a continuity doctor.
- Keep background knowledge convergence moving: regenerate rejected documents with the reviewer's reasons, park only exhausted sources with precise status, review lifecycle plans by their own paths, and settle undeclared opaque assets by the passing delegation suite.
- lervo upgrade --apply --safe plans and applies an approval-free upgrade in one exclusive window, and a stale --approval names the current plan ID and what changed.
- lervo upgrade --apply holds the background knowledge resident's cycle admission for its whole run, scans retry concurrent revision changes, and foreground commands wait up to 15 minutes for a running knowledge materialization instead of failing.
- lervo upgrade applies Node configuration path migrations only inside the guarded service transition, recovers Nodes whose configuration was migrated in place, and names fence refusals such as a configuration digest mismatch.
- lervo upgrade keeps a per-host current CLI pointer and moves pinned Node configuration CLI paths to it with a backup; Node startup names a missing configured executable, and node status reports it before a restart.
- Node upgrades wait up to 15 minutes for a running supervision cycle or admitted work instead of refusing at the first collision.
- Publish background knowledge within the delegated write scope, never rewrite tool-generated documents such as release-please changelogs, repair knowledge commits that changed them automatically, and derive the publication base from the remote's advertised default branch.
- Publish repository Node readiness without waiting for the conversation knowledge index, refresh a starting Node's health heartbeat, and count that heartbeat as readiness progress so a slow but live startup is not rolled back.
- Recover bounded knowledge evidence and add independently reviewed freshness assessments. Status now returns version-2 metadata observations; use inspect for authoritative verification. Improve resident scheduling and retain normalization cost limits.
- Reevaluate every settled background knowledge stall once after a runtime deploy, give co-hosted residents fair turns at full-cycle admission, park rejected lifecycle plans instead of stopping assessment, and retry a project manifest that lervo upgrade briefly rewrites.
- Regenerate a background knowledge review whose bound context changed instead of stopping, never bind the rebuildable publication pages as review context, and reuse the repository observation within a resident cycle so a large repository no longer holds a core.
- Regenerate a stale knowledge review before the pre-stage check, stop pinning package manager lockfiles as opaque delegation assets, and memoize role registry resolution.
- Renew each convergence delegation only on the convergence owner with deterministic bytes, let followers adopt the owner's term or bytes, and stop replica apply, merge, and rollback from resetting a renewed tracked delegation to HEAD.
- Report knowledge_normalization_outside_delegation with the excluded normalization roots when every pending normalization document lies outside the delegation, instead of an opaque knowledge_authority_unavailable.
- Route legacy repository documents semantically instead of by title terms, keep application content that its own package loads in place, and defer unclassified documents to the background resident without blocking lervo upgrade.
- Scan supplemental evidence sources in linear time so event-heavy repositories no longer spend minutes of CPU per knowledge scan.
- Start an absent delegated knowledge integration ref at HEAD, bound untyped convergence stage failures to four attempts before attention, and show the retry attempt and next attempt time in convergence status.
- Synchronize repository checkpoints from CLI-only hosts and explicitly reconcile divergent continuations without rewriting their histories.
