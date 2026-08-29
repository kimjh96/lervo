# ADR-0259: Preserve Claude selection failures for provider-shadow v6

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v5](../../../evidence/search/linked-evidence-provider-shadow-pilot-v5.md) completed a Claude turn but failed while constructing the unavailable observation because the bounded identifier validator omitted the new coordinate prefix. The controller had not persisted the in-memory provider outcome before constructing that observation, so no exact bounded result or selection failure code survived. V5 is terminal, rejected, and not resumable.

## Decision

Allow bounded unavailable identifiers for v5 and v6 coordinates. After every provider-turn outcome, persist the cumulative invocation count, outcome status, and bounded provider failure code before baseline comparison or observation construction. No-call recovery preserves that exact failure code when present and adds the current accepted invocation to the cumulative journal count.

Map explicitly requested but absent Claude structured output to `provider_shadow_result_invalid`. Continue mapping schema or token violations to `provider_shadow_selection_invalid`. Retain neither raw provider output nor provider diagnostics.

Run a fresh v6 Claude-only micro-pilot on the three reviewed cases unused by v5, with fresh `psv6_` coordinates. Preserve the same JSON Schema, model, thresholds, privacy boundary, no-effect boundary, three-call maximum, first-failure stop, and no-retry rule. The cumulative v2-v6 ceiling is 57 calls.

## Consequences

Passing v6 authorizes only a separately reviewed, fresh, paired 24-by-24 Codex-Claude rerun. It does not authorize reuse of prior Codex results, canary traffic, or production activation.

## Verification

- Test acceptance of v5 and v6 unavailable coordinates and classification of structured-result failures.
- Verify outcome persistence precedes observation construction and that recovery preserves invocation totals.
- Prepare three provider-free v6 attempts and bind the exact contract and current workstream.
- Execute once, stop at the first failure, run exact review, and publish bounded evidence.
- Complete quality, documentation, knowledge, repository, and task-base release checks.

## References

- [ADR-0258](0258-correct-claude-structured-selection-provider-shadow-v5.md)
- [V5 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v5.md)
- [Exact v6 contract](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v6.json)
