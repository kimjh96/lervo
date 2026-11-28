# ADR-0655: Give a repository without a suite a default knowledge suite

Status: `accepted`
Decision date: 2026-11-28
Related: [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) (template seeding, which this extends for a repository without a suite), [ADR-0477](../../coordination/sync/0477-carry-delegation-bound-definitions-across-hosts.md), [ADR-0536](../../execution/providers/admission/0536-admit-provider-clis-by-contract.md), [fleet continuity](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md)

## Context

Seeding a convergence delegation binds the repository's own default verification suite. Seeding accepts the latest `repository.default.vN`, `repository.default`, or exactly one other non-pilot suite. With none of these, the seed fails with `convergence_seed_verification_missing`, and nothing anywhere creates a suite. On 2026-11-28 the new Mac project `~/Lervo/axli` had no `.lervo/verifications/`, and neither had axli-lab before it. Background knowledge maintenance therefore never started for either repository, and the host reported `knowledge_authority_unavailable` indefinitely. The owner rule [rule_304aa2496fe08f7935fb1c8c](../../../instructions/generated/rule_304aa2496fe08f7935fb1c8c.md) requires that new projects receive automatic knowledge maintenance.

## Decision

1. **A default suite exists for every repository.** When a template seed finds no suite it can bind, the resident installs `.lervo/verifications/lervo.default.knowledge.yaml`, then seeds with it. The suite has one command, `lervo knowledge lint`. The convergence worker changes only knowledge, the lint checks exactly that, and the lint needs no project toolchain. Verification runs in the owner's login-shell `PATH` (ADR-0536), where `lervo` resolves. With only `PATH` set, the lint exits 0 on a fresh clone of axli.
2. **An owner suite always wins.** Seeding prefers `repository.default.vN`, then `repository.default`, then exactly one other non-pilot suite. The default ID sits outside all of these, so it is chosen only when the repository has no suite of its own. Its presence never makes an owner's single suite ambiguous. Automatic deliberation ignores it, because a knowledge lint never verifies a code change.
3. **Installation follows ADR-0477.** The file is created only where none exists. It is recorded as Lervo-managed in `.lervo/state/knowledge/convergence-installed-definitions.json` and written in one durable knowledge transaction. A `knowledge.materialization.applied` event announces it, with operation `convergence_default_verification_suite`. Like every installed definition, it is not committed. An owner who commits or edits it takes it over.
4. **Every host binds the same suite.** The bytes are fixed in the release, so every host hashes them identically. A host that seeds from a peer whose scope binds the default installs it itself and needs no Hub copy. Any other peer seed installs only what the peer binds.
5. **The finding names the cause.** `convergence_seed_verification_missing` and `knowledge_authority_unavailable` state the missing suite and its automatic fix. They no longer say only that the resident retries.

## Consequences

- A project that the ADE adds or creates, whether by `lervo project add` or by the follower's pass, reaches a seeded delegation on the resident's next cycle without an owner step. Nothing is written into `lervo init` or `lervo upgrade`; the resident's seeding is the one place that decides.
- Until the owner commits the suite, `git status` shows `.lervo/verifications/lervo.default.knowledge.yaml` as untracked, as it already shows other installed definitions.
- A repository whose knowledge fails `lervo knowledge lint` keeps failing convergence verification until the lint passes. The verdict names the failing check.
