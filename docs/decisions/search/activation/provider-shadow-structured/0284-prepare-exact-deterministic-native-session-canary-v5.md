# ADR-0284: Prepare the exact deterministic native-session canary v5

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0283](0283-prepare-deterministic-linked-context-canary-v4.md) prepared a provider-free population in which every paired run has two to six exact additional linked candidates. Its manifest, `sha256:c3a5983fc19b0543e5a951a7dca19d89a89c1300e6e146a81dd107441ebef8ba`, made zero provider calls and proved the population. Because it preceded the runtime implementation, it cannot authorize execution against the later source and build snapshot.

The implementation validates the exact deterministic policy, source snapshot, projection digest, selected-version digest, and count before creating an ordinary task adapter. It creates no selection adapter and performs no credential lookup. Schema-v2 canary records distinguish provider-turn selection from deterministic-policy selection, separate candidate bytes from provider-visible selection bytes, and retain null selection-adapter receipts and usage without inventing telemetry. Preserved schema-v1 records remain valid.

## Decision

Prepare a fresh v5 checkpoint over the same 16 paired source tasks using the deterministic all-current-candidate policy. Bind all of the following:

- Policy digest `sha256:8063ff4d0c1825b3abe35f81a53f245b988b8c6ea1e0cdacf2a690bbea76cb18`.
- The exact current source and built CLI.
- Schema-v2 evidence behavior.
- The v4 preparation manifest.
- The v1 terminal failure.
- The unchanged isolated source population.

V5 makes zero selection calls and permits at most 16 future provider calls: eight ordinary read-only Codex task calls and eight ordinary read-only Claude task calls. Each call uses its provider-native signed-in session. User API keys, selection transports, retries, repairs, fallbacks, replacement runs, writes, external messages, Hub effects, direct-terminal effects, operational-search changes, and production traffic remain prohibited.

Preparation makes no provider call. The owner-only manifest initially grants no execution, managed-context-effect, or production authority. Any later execution operation must bind the exact final manifest digest and recheck its source and build snapshot before creating the first task adapter. No earlier v1-v4 approval or generic continuation can replace that exact binding.

## Consequences

This checkpoint joins the key-free execution design with an effect-bearing paired population. The 16-call ceiling is half the original 32-call design, but this represents avoided experimental work, not measured speed, token, billing, or accuracy savings.

Preparation does not activate the product. Final Codex-Claude speed, accuracy, reference precision, provider-reported usage, and cost reporting require all 16 task runs, exact E1-E4 evidence, unchanged repository effects, and independent expected-claim review.

## Verification

- Prove that all 16 runs select every exact current candidate, each run has two to six nonempty selections, and paired source tasks are identical.
- Prove the runtime policy digest, schema-v2 deterministic evidence, schema-v1 compatibility, zero selection-adapter creation, zero selection calls and bytes, absence of credential fields, and the 16-call ceiling.
- Prove provider-free preparation, exact replay, owner-only mode, current source and build bindings, and immutable v1-v4 predecessors.
- Run focused and full repository checks, documentation lifecycle, knowledge migration and lint, and exact-base release completion.

## References

- [Deterministic population decision](0283-prepare-deterministic-linked-context-canary-v4.md)
- [V3 rejection evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v3.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
- [Measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
