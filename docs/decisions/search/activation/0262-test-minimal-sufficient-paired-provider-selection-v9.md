# ADR-0262: Test minimal-sufficient paired provider selection in v9

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v7](../../../evidence/search/linked-evidence-provider-shadow-pilot-v7.md) proved Claude structured-selection compatibility and preserved 100% recall, but redundant adjacent and broad sources reduced mean precision to 52.22%. [Provider-shadow v8](../../../evidence/search/linked-evidence-provider-shadow-pilot-v8.md) limited each selection to two sources but omitted required evidence, leaving recall and precision at 50%.

Codex has one eligible historical observation. It is useful but cannot establish activation quality or support a paired comparison. Neither provider may reuse an earlier result under a changed selection protocol.

## Decision

Replace the rejected two-source cap with one provider-neutral minimal-sufficiency refinement. Retain the v8 selection instructions and require the provider to:

- Select the smallest sufficient evidence set.
- Include a document only for a distinct required claim.
- Exclude merely related or redundant background.
- Remove any selection whose removal preserves direct support for every required claim.
- Retain a selection when its distinct claim would otherwise be unsupported.

Do not expose expected counts or ground truth; add case-specific or question-category routing; alter candidate order or bodies; lower thresholds; or add a hard cap below the existing maximum of eight.

Run one fresh paired micro-pilot across all six human-reviewed eligible cases at repetition four. Use fresh `psv9_` coordinates and alternate the starting provider by source sample. Allow exactly six Codex calls and six Claude calls, with no retry, replacement, repair, answer, or publication turn. Stop the entire pilot at the first unavailable or failed observation. The cumulative v2-v9 ceiling is 75 provider calls.

Codex uses its exact standalone E4-token carrier. Claude uses its provider-native JSON Schema carrier normalized to the same exact token set. Carrier syntax is provider-specific; candidate bytes, semantic selection instructions, ground truth, token identity, review rules, and effect boundaries are identical.

## Evidence, privacy, and failure meaning

V9 uses `linked_evidence_provider_shadow_candidate.v9`, `linked_evidence_provider_shadow_attempt.v9`, and `linked_evidence_provider_shadow_observation.v9`. They retain the existing bounded candidate, durable adapter-coordinate, selection, duration, usage, digest, accuracy, replay, and no-effect fields. Records remain owner-only, deletable derived state and never synchronize to Hub.

Do not retain raw provider output, prompts, queries, source bodies, paths, credentials, billed costs, or unrestricted diagnostics. Existing bounded provider-shadow failure codes retain their meanings. Any missing carrier, invalid token set, incomplete usage, unexpected tool or command, replay mismatch, privacy failure, or primary-effect difference rejects v9 without retry.

Each provider must independently produce six eligible observations satisfying all of these gates:

- 100% reviewed expected-path recall.
- At least 65% mean precision.
- At least 50% precision per observation.
- No more than eight selections.
- Complete duration and usage.
- Zero unavailable, replay, privacy, adapter, result, usage, relevant-source-drop, or primary-effect failures.

Passing authorizes only a separately pre-registered, fresh 24-by-24 paired measurement. It does not authorize managed-context changes, direct-terminal changes, canary traffic, or production activation.

## Verification

- Bind the exact v7 base, v9 overlay, minimal-sufficiency protocol digest, all six repetition-four cases, and 12 paired attempts.
- Test provider-native carrier selection: standalone comments for Codex and structured JSON Schema for Claude, normalized to the same exact E4 token set.
- Reconstruct the six source samples provider-free and prove identical within-pair request and candidate-envelope digests.
- Execute once, stop at the first failure, run exact review, and publish provider-specific and paired measurements.
- Run focused tests, quality, documentation, knowledge, full-repository, and task-base release-completion checks.

## References

- [ADR-0261](0261-bound-provider-shadow-selection-to-two-sources-v8.md)
- [Final Codex-Claude measurement report](../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
- [Exact v9 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v9.json)
