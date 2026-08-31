# ADR-0324: Pre-register provider-query-projector v6 context restoration

Status: `accepted for evaluation only`
Date: 2026-08-31

## Context

Provider-query-projector v5 report `lv2real_cd3172e5b341f22faa2dc375`, hash `sha256:c756e0973a107081705a72a98d3d010d13a995e86c5a9665f733390d118398bf`, bound projector build `sqbuild_ee4c4bf8f7f6682adddba70f`, admission `pqadm_e6e213d88da78657097aebd1`, and the 460-document corpus digest `sha256:0e06634aaf4f9ac733806843c2f0e031fab7166a2b10287f8c7221b4db042d6f`. One observation was incomplete at 20,050 milliseconds. Thirteen of 20 lexical-v2 observations passed. The report remains failed evidence and cannot be retried or partially accepted.

All five `actual_raise_v2_to_pass` repetitions missed ADR-0318 at ranks 31–36. Before v5, agent bookkeeping accidentally replaced the active workstream's ADR-0318 reference with the v5 decision reference. Current-workstream references are approved local context anchors composed after provider projection, so this removal changed the evaluated context without changing the human-reviewed suite. Provider-free execution with the prior ADR-0318 reference restored places both expected documents within the unchanged rank-10 bound.

## Decision

Restore the pre-existing ADR-0318 current-workstream reference and create provider-query-projector v6 before another provider call.

- Bind the projector as `lervo.provider-query-projector.v6`. Continue using Codex runtime contract `codex.persistent_isolated_thread_admission.v2` and Claude runtime contract `claude.serialized_process_admission.v1`.
- Preserve the current-workstream objective, next actions, and all other relevant references. The restored reference is ordinary task context, not a benchmark-only alias, rank boost, hidden expected-path input, or search-engine rule.
- Keep context-anchor composition local and deterministic. Instruct the provider not to repeat anchors. Give it no expected-path or case metadata, and allow it to generate only the remaining queries within the unchanged eight-query maximum.
- Preserve one synthetic admission, one attempt per reviewed observation, isolated Codex threads, serialized fresh Claude processes, complete usage, capability isolation, and the 20-second projection bound.
- Do not retry, replace, delete, or combine any v5 observation. V6 is a new projector and workstream-context coordinate over a newly frozen current corpus.

No reviewed case, query, expected path, match policy, maximum rank, repetition count, provider, default model, effort, schema, retrieval engine, per-query limit, fusion algorithm, privacy exclusion, or activation threshold changes.

## Activation gate

Run Codex first on the unchanged suite with five repetitions. Run Claude only if all 20 Codex observations pass. Both reports must bind the same current Markdown corpus, record complete usage, contain zero projection failures, remain within 20 seconds per projection, and pass every lexical-v2 rank check. Only the resulting v6 pair may populate the ADR-0321 review and activation bundle.

Operational engine and retrieval-plan selections remain on their explicit baselines until the bundle is activated and the selected-plan, rollback, baseline, reactivation, and final-readiness observations pass.

## Failure meaning and privacy

A failed or over-budget v6 projection invalidates its provider population and establishes no selection, loading, injection, reference, or provider use. The runner and report continue to exclude request, context, anchor, projected-query, reasoning, response, configuration, credential, repository-content, and provider-output text. Only bounded hashes, identifiers, durations, usage, ranks, and privacy dispositions remain as evidence.

## Verification

- Provider-free projection and fusion verification must prove that the restored reference stays within current limits and places both reviewed sources within rank 10.
- Focused tests must prove that v6 changes projector build identity while preserving v2 Codex item classification and isolation.
- Fresh five-repetition Codex and Claude reports must cover the unchanged reviewed suite on one corpus without retries.
- ADR-0321 activation, selected terminal retrieval, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness must all pass.
- Quality, type, documentation lifecycle, knowledge lint, release-completion, and package checks remain required before completion.

## References

- [V5 item classification](0323-pre-register-provider-query-projector-v5-item-classification.md)
- [V20 qualification](0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Reviewed real-use suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
