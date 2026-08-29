# ADR-0267: Retain bounded selection-violation codes

Status: `accepted`
Date: 2026-08-29

## Context

[V12](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v12.md) stopped after a completed Codex turn failed the exact-token selection grammar. The durable observation retained `provider_shadow_selection_invalid` but excluded raw provider output, so it could not distinguish prose, malformed structure, unknown markers, duplication, or selection-count overflow. Repeating confirmation without identifying the violation would create success-selection bias rather than evidence for a correction.

## Decision

Add `selectionViolationCodes` to future provider-shadow unavailable outcomes, attempt journals, immutable observations, and recovery materialization. It is a sorted, unique array limited to these parser-owned values:

- `non_standalone_or_malformed_e4_marker`;
- `provider_shadow_prose_present`;
- `unknown_e4_marker`;
- `duplicate_e4_marker`;
- `too_many_selected_sources`;
- `malformed_structured_selection`;
- `invalid_structured_selection_shape`.

Populate it only from the deterministic, provider-neutral token parser. A `provider_shadow_selection_invalid` result requires at least one bounded code; other unavailable results carry an empty array. Persist the array before constructing the observation so recovery retains it after an interrupted write.

Do not retain raw provider output, prose, tokens, fragments, paths, prompts, unrestricted errors, or provider-native diagnostics. The codes do not change parsing, acceptance, thresholds, retry policy, provider behavior, or prior records. V12 remains immutable and unclassified beyond its existing generic failure.

## State, privacy, and failure meaning

`selectionViolationCodes` is required on newly generated unavailable observation records under this behavior. It comes from the local parser, has cardinality bounded by the seven-value enum, and contains no user or source content.

A nonempty array means only that the completed result violated one or more exact selection-carrier rules. It does not prove provider understanding, malicious content, selected-source correctness, or that parser relaxation is safe. An empty array on another failure means selection parsing supplied no classified violation; it does not prove valid output.

No event is added. Owner-only attempt and observation state retain the field under the existing bounded pilot retention policy.

## Verification

- Unit tests bind the enum, sorting, uniqueness, and rejection of unbounded codes.
- Turn tests prove that prose failure records only the bounded code and no raw content.
- Execution and recovery persist identical codes without changing fail-closed stopping.
- Quality, documentation, knowledge, full-repository, and task-base release-completion checks remain required.

## References

- [V12 evidence](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v12.md)
- [ADR-0266](0266-confirm-claim-coverage-over-four-cases-v12.md)
