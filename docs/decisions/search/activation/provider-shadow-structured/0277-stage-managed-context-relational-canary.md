# ADR-0277: Stage the managed-context relational canary

Status: `accepted`
Date: 2026-08-29

## Context

[V18](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md) passed 32 fresh Codex-Claude calls across four reviewed unambiguous cases. Both providers achieved 100% recall in every observation and passed unchanged precision, structured-output, usage, replay, privacy, and no-effect gates. This proves selection quality only for the fixed population; it does not prove that selected linked bodies can safely replace or extend managed E1-E4 context in an ordinary task run.

Operational search remains `lexical-v1`. The production linked-evidence integration remains an effect-free local shadow. Direct terminals lack a managed adapter delivery receipt and are outside this activation path.

## Decision

Design `linked-evidence-managed-canary-v1` as a default-disabled post-recommendation context selector for managed runs only. It must not change search engine selection, lexical scores, recommendation batches, repository knowledge projection, direct Codex or Claude terminal behavior, or non-canary runs.

For each explicitly prepared eligible canary run:

1. Build the unchanged one-hop linked candidate projection after validated lexical recommendations.
2. Make one provider selection call through the provider adapter using the v17 relational protocol digest and compatible exact E4-token JSON Schema carrier.
3. Reject unknown, duplicate, excessive, stale, or hash-mismatched selections before loading any body.
4. Load at most eight selected sources. Expose at most 117,813 source bytes to the selection call and validate exact hashes before and after loading.
5. Deliver validated context through the existing managed adapter boundary. Record `selected`, `loaded`, `injected`, and final `referenced` evidence independently. Never claim `used` without provider telemetry that directly proves it.

Codex and Claude adapters retain provider-specific request and result translation. Core selection validation, loading, evidence, and canary policy remain provider-neutral.

A selection failure stops that run before the task turn. It must not fall back silently to baseline context, inject partial sources, retry, or affect later runs.

## Canary state and privacy

Keep one owner-only bounded record per prepared run under `.lervo/state/search/linked-evidence-managed-canary/`, with at most 64 records and no overwrite. Record only:

- canary, project, run, provider-arm, policy, protocol, source-snapshot, recommendation-batch, selection-attempt, adapter-receipt, and context-delivery identifiers;
- candidate, selected, loaded, injected, and referenced counts and digests;
- provider-visible, selected, loaded, and injected byte counts;
- duration and provider-reported usage totals; and
- status `completed` or `failed` with one allowlisted failure code.

Exclude queries, prompts, source or result bodies, paths, titles, link text, credentials, absolute paths, unrestricted provider errors, and user output. Provider-reported tokens are usage evidence, not billing evidence.

| Failure code | Meaning |
| --- | --- |
| `canary_not_eligible` | The run, provider, corpus, or explicit exposure coordinate is outside the prepared population. |
| `canary_selection_unavailable` | The selection call or common structured result was unavailable. |
| `canary_selection_invalid` | Selected tokens violated identity, duplicate, count, or protocol rules. |
| `canary_source_changed` | A selected registered source was missing, unsafe, or changed before delivery. |
| `canary_delivery_unconfirmed` | The adapter did not confirm exact managed-context delivery. |
| `canary_evidence_incomplete` | Required state, usage, replay, privacy, or final-reference evidence was incomplete. |
| `canary_storage_failed` | The bounded record could not be durably written and read back. |

## Exposure and advancement

Implementation may proceed behind the default-off policy with common adapter contract tests and no live traffic. Before the first live call, a later execution checkpoint must bind the exact registered corpus, source revision, provider models, protocol and schema digests, task population, call ceiling, operator authority, and rollback predecessor.

The first live canary is limited to:

- one isolated registered corpus;
- read-only tasks;
- 16 total task runs: eight Codex and eight Claude;
- one selection call and one task call per run, for at most 32 provider calls; and
- alternating provider order over the same reviewed task population.

Writes, external messages, Hub effects, direct-terminal effects, and production traffic are prohibited.

Advancement requires all 16 task runs, zero allowlisted failures, exact replay, zero privacy violations, identical non-context primary inputs, complete E1-E4 evidence, 100% required-source recall in final references, at least 50% per-run and 65% mean reference precision per provider, and an independently reviewed answer-quality comparison against fixed expected claims.

Any failure stops the canary without retry and restores the default-off predecessor for later runs.

## Consequences

This decision authorizes implementation and provider-free verification of the default-off canary path. It does not authorize the first live canary, managed-context effects, production traffic, direct-terminal changes, or general activation. Those require the prepared execution checkpoint defined above.

## Verification

- Run the common provider adapter contract suite for the structured selection call.
- Prove byte-for-byte baseline parity when the policy is disabled or the run is ineligible.
- Prove fail-closed schema, identity, hash, byte, count, delivery, persistence, privacy, and no-retry behavior.
- Prove exact separation of `selected`, `loaded`, `injected`, and `referenced`, plus rollback to the default-off predecessor.
- Run focused tests, `pnpm quality:check`, the complete repository implementation check, knowledge migration and lint, and exact-base release completion with reviewed release intent.

## References

- [ADR-0248](../../0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0276](0276-confirm-relational-coverage-provider-shadow-v18.md)
- [V18 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md)
- [Managed context grounding](../../../execution/providers/0198-managed-context-grounding-and-coverage.md)
