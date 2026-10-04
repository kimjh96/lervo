# ADR-0354: Shard full runtime verification on busy hosts

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The installed Lervo Node used the exact reviewed `repository.default.v5` suite for a three-document normalization apply. Lint and type checking completed, but its four-worker full Vitest command reached the 1,800-second schema maximum. The knowledge worker recorded a transient failure at 07:45:01 UTC; no passing apply or current knowledge receipt was recorded. Increasing the timeout is outside the verification-suite schema, and changing version 5 in place would alter a historical evidence definition.

## Decision

Add `repository.default.v6`, preserving lint, typecheck, risk classification, related-test selection, the four-worker bound, and the 1 MiB per-command output bound. Replace the single runtime command with four sequential commands passing `--shard=1/4` through `--shard=4/4` to Vitest. Each retains the 1,800-second maximum. Together, the four positions cover the selected test-file set; `stopOnFailure` prevents a passing suite if any position fails or times out.

The version-six pure plan reuses the frozen version-five plan and adds only an exact shard position. A separate runner observes the same bounded Git path set and emits the selected mode, bounded escalation triggers, worker count, and shard position before invoking Vitest. The suite remains repository-authored and provider-neutral. Do not pool results across versions 4, 5, and 6 without retaining their distinct suite IDs and hashes.

An installed worker may use version 6 only after the exact reviewed delegation binds its suite ID and hash. A full version-six pass proves all four Vitest shards completed under the recorded repository revision and environment. It does not prove external service behavior, knowledge currency, or release readiness.

## Verification and limits

Focused plan tests cover all four distinct shard arguments, retention of full escalation and related Git selection, and rejection of invalid positions. The installed four-command result and final knowledge receipt remain acceptance gates. A shard can still exceed 1,800 seconds or fail; the worker must record that failure without claiming apply completion.

## Responsibility review

- `verification-plan-v6.mjs` owns pure shard selection.
- The version-six runner owns bounded diagnostics and the Vitest process boundary.
- The suite YAML owns command order and timeouts.

These short modules add no provider-specific or canonical-knowledge policy.

## References

- [ADR-0352](0352-escalate-opaque-runtime-changes.md)
- [ADR-0353](0353-bound-full-runtime-verification-on-busy-hosts.md)
- [Autonomous background knowledge convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
