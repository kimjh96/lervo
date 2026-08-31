# ADR-0325: Pre-register provider-query-projector v7 owned lifecycle

Status: `accepted for evaluation only`
Date: 2026-08-31

## Context

Provider-query-projector v6 passed the frozen reviewed suite for both providers. Codex report `lv2real_b7f6cb00f1f8ac458515f918`, hash `sha256:1d0888580366ee070cdc7e8a712d5c19a64f5d6b1ad3897e44b7764619560bbb`, bound build `sqbuild_158b4f9ace320cfb418dc041`, passed 20 of 20 observations. Claude report `lv2real_66c27072fa83ba607c4a3c2b`, hash `sha256:5e042d84f0749c32e2f4d73ab236817987b2e185ffbfc9dbc444c48f315cc98a`, bound build `sqbuild_eda50d3c0610a5bdeb198b1d`, also passed 20 of 20. Both used the same 461-document corpus digest, `sha256:72b00ae49c085ffec70203b7ad502491a644de58801a0c01e1d3bd017528788e`, recorded complete usage, and had no projection failures.

Bundle `srpbundle_2eb1a2aea46f7e27433a309f` selected those builds as candidate transition `srpact_a6fce08a8febf1dfa58c4f5b`. The first selected terminal-hook observation failed closed and retained the provider runner after the one-shot hook invocation. The production projector had cached an admitted Codex app-server runner without an owner able to close it, so the hook process did not complete a selected-plan retrieval observation. Transition `srpact_cb0ec2cfd4adbce1e0f2c573` rolled the candidate back to baseline. The v6 reports remain valid retrieval-quality evidence, but neither they nor the failed terminal observation establish activation.

## Decision

Create provider-query-projector v7 with explicit runner ownership before another provider call.

- Bind the projector as `lervo.provider-query-projector.v7`, the Codex runtime as `codex.persistent_isolated_thread_admission.v3`, and the Claude runtime as `claude.serialized_process_admission.v2`.
- Reuse a prepared runner only within an explicit owner, such as one frozen evaluation population. The owner must close the runner in a `finally` block.
- The one-shot production projector must prepare exactly one admitted runner, perform exactly one projection, and close the runner before returning. It must not cache a provider child process across terminal-hook invocations.
- Preserve the v6 instruction, response schema, request/context privacy digests, approved-anchor composition, query limits, fresh Codex thread per projection, serialized fresh Claude process per projection, usage observation, capability isolation, and 20-second bound.
- Keep the selected terminal path fail closed. Runner admission, projection, or close failure establishes no selected retrieval result and exposes no prompt, context, projected query, provider output, configuration, or credential text.

No reviewed case, query, expected path, match policy, maximum rank, repetition count, provider, default model, effort, retrieval engine, per-query limit, fusion algorithm, privacy exclusion, or activation threshold changes.

## Activation gate

Freeze the current Markdown corpus after this decision and lifecycle implementation are normalized and migrated. Run Codex first on the unchanged suite with five repetitions. Run Claude only if all 20 Codex observations pass. Both reports must bind the same corpus, record complete usage, contain zero projection failures, remain within 20 seconds per projection, and pass every lexical-v2 rank check.

Only the resulting v7 pair may populate a new reviewed bundle. Activation then requires a completed selected terminal retrieval whose hook process exits normally, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness. A v6 report or bundle cannot substitute for these v7 coordinates.

## Failure meaning and privacy

A failed or over-budget v7 projection, an unclosed runner, or a non-terminating hook invalidates that observation and establishes no selection, loading, injection, reference, or provider use. Reports and receipts retain only bounded hashes, identifiers, durations, usage, ranks, lifecycle dispositions, and privacy dispositions.

## Verification

- Focused tests must prove that production closes both provider runners after success and failure, while owned evaluation runners remain explicitly reusable.
- Generated terminal runtime must contain the v7 lifecycle and pass integrity verification.
- Fresh paired reports must pass the unchanged reviewed suite on one frozen corpus without retries.
- Selected terminal retrieval, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness must pass.
- Quality, type, documentation lifecycle, knowledge lint, release-completion, and package checks remain required before completion.

## References

- [V6 context restoration](0324-pre-register-provider-query-projector-v6-context-restoration.md)
- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Reviewed real-use suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
