# ADR-0591: Accept the previous follower's upgrade arguments

Status: `accepted`
Decision date: 2026-11-19
Amends: [ADR-0561](../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (`lervo upgrade --apply` accepts and drops `--approval <plan-id>`; every `lervo upgrade --json` failure prints one JSON envelope)
Related: [ADR-0575](0575-follow-published-releases-on-every-host.md) (the follower runs `lervo upgrade` and treats a run without a JSON result as a host failure), [ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (the activation and its rollback)

## Context

v0.27.0 shipped ADR-0561 and was published at 13:56 UTC on 2026-11-18. Both hosts installed it and rolled it back:

- the Mac recorded `rolled_back` (`host_follow_repository_upgrade_unreadable`) at 14:09 UTC;
- WSL reported `release_failed_on_host`.

Every later cycle on both hosts reported `release_failed_on_host` for v0.27.0, and every repository stayed on v0.26.0.

The cause is a version skew inside the follower:

- **The follower is still 0.26.0.** Its service runs `host-follow-runtime`, which keeps pointing at the previous package until a release pass succeeds (ADR-0575). So a 0.26.0 follower drove the 0.27.0 `lervo`.
- **It sends a removed flag.** For a `ready` plan, the 0.26.0 follower runs `lervo upgrade --root <path> --apply --approval <plan-id> --json`. ADR-0561 removed `--approval` from `lervo upgrade`.
- **The refusal was not JSON.** v0.27.0 refused with one line on stderr and nothing on stdout. The follower reads a run that exits without a JSON result as `host_follow_repository_upgrade_unreadable`, a host failure, so it rolled the release back.

The cause was confirmed read-only on the Mac with the installed 0.27.0 package:

- `lervo upgrade --json` planned axli normally;
- `upgrade --apply --approval <id> --json` printed only the removal message.

No test ran a previous release's follower against the new CLI.

## Decision

1. **Accept `--approval` with `--apply`.** `lervo upgrade --apply` accepts and drops `--approval <plan-id>`. `--apply` already plans again inside the exclusive window and cross-checks each stage, so the echoed plan ID adds nothing. Without `--apply`, `--approval` is still refused. `--approve-role-binding` stays removed.
2. **JSON failures for JSON callers.** Under `--json`, a removed option fails with `upgrade_option_removed`, and an argument error with `upgrade_arguments_invalid`. Both print one JSON failure envelope on stdout. A follower then classifies such a refusal as a repository failure, not as an unreadable host failure.
3. **A compatibility test pins the previous follower's arguments.** `upgrade-follower-compatibility.test.ts` copies the v0.26.0 follower's three argument lists literally: plan, exact apply, and `--safe` apply. It requires each one to produce a result that the follower's parser reads as `result`.

## Consequences

- **v0.27.1 installs through a v0.26.0 follower.** Once its release pass succeeds, the follower moves its runtime to v0.27.1, and later passes send `--apply` alone.
- **A held repository stays held.** The 0.26.0 follower does not read `repository-holds.json`, but the 0.27.1 `lervo upgrade` it runs does. Every changing stage of a held repository is reported as `owner_hold` debt, and nothing is written.
- **Future removals must update the test first.** A release that removes or renames a follower argument must keep accepting the previous release's form for at least one release. The test fails until the copied argument lists match what the previous follower actually sends.
- **Rollback:** revert this change. Releases after v0.27.0 then fail on every host whose follower still runs v0.26.0.
