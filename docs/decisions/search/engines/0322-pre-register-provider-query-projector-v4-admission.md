# ADR-0322: Pre-register provider-query-projector v4 admission

Status: `accepted for evaluation only`
Date: 2026-08-31

## Context

ADR-0321 requires fresh five-repetition Codex and Claude reports before activating the reviewed retrieval plan. Provider-query-projector v3 report `lv2real_f299bc95b43df3425c0c4d51` used the unchanged four-case suite and current corpus. Fifteen of its 20 Codex projections passed the lexical-v2 quality and 20-second duration gates; five failed when native `codex exec` processes exited during provider overload. The failed report remains evidence and cannot be retried into acceptance.

A synthetic-request diagnostic reproduced the provider `overloaded` failure. A separate synthetic diagnostic admitted one no-capability Codex app-server process, then completed ten sequential requests on ten new threads with usage and without provider errors or capability-bearing items. This supports a lifecycle correction without changing any reviewed case, expected path, threshold, model, or retrieval stage.

## Decision

Create provider-query-projector v4 with a provider-native admission boundary before report measurement.

- Codex starts one app-server process with project hooks, MCP servers, tools, command execution, file changes, browser access, plugins, apps, subagents, and all other model capabilities disabled. A synthetic structured-output turn must complete with usage before admission. Each evaluated projection uses a new thread and turn on that process; prompt, context, response, and thread state never cross observations.
- Claude retains serialized no-capability processes. One synthetic structured-output process must complete with usage before the first evaluated projection, and every evaluated projection uses a fresh process.
- Admission occurs outside projection duration. Its content-bound provider-report receipt records provider, strategy, duration, normalized usage, status, and privacy disposition. It excludes request text, response text, provider output, configuration, credentials, and repository content.
- Each reviewed case and repetition is one attempt. No failed evaluated projection may be retried, replaced, deleted, or combined with another report. Provider errors, missing usage, invalid JSON, capability-bearing items, timeout, or non-completion fail the population.
- The projector build binds the v4 contract, provider, model, system prompt, response schema, and exact runtime admission strategy. V3 build `sqbuild_c573f753d7e37ed8788f6cd8` remains rejected evidence.

The synthetic admission turn is readiness evidence only. It is not a reviewed-suite observation, does not count toward quality, and cannot compensate for a failed evaluated projection. If admission fails, the command produces no activation-eligible population report.

## Activation gate

Run Codex first on the unchanged suite with five repetitions and no retries. Run Claude only if all 20 Codex observations pass. Both reports must bind the same current Markdown corpus, record complete usage, contain zero projection failures, keep every projection within 20 seconds, and pass all lexical-v2 rank checks. Only those two reports may populate the exact ADR-0321 review and bundle.

Operational engine and retrieval-plan selection remain on their explicit baselines until the complete bundle is activated and the selected-plan, rollback, baseline, reactivation, and final readiness observations pass.

## Failure meaning and privacy

`provider_query_admission_failed` means the isolated provider boundary was not ready before a reviewed observation began. It establishes no report, selection, loading, injection, reference, or provider use. A failed evaluated projection retains the existing `failed` projection receipt and invalidates its complete population.

Admission receipts retain only bounded identifiers, strategy, duration, normalized usage, status, and explicit privacy exclusions. They retain no prompt, request, projected query, context, provider output, configuration, credential, absolute path, or source body.

## Verification

- Focused tests cover admission identity, runtime-bound projector identity, fresh-thread isolation, capability-bearing item rejection, complete usage, and cleanup.
- Fresh Codex and Claude five-repetition reports cover the unchanged reviewed suite on one corpus.
- ADR-0321 activation, selected terminal retrieval, explicit rollback, baseline readiness, unchanged-bundle reactivation, and final selected-plan readiness must all pass.
- Quality, type, documentation lifecycle, knowledge lint, release-completion, and package checks remain required before completion.

## References

- [Retrieval-plan activation](0321-activate-lexical-v2-through-retrieval-plan-selection.md)
- [Provider-native warm admission](0316-pre-register-lexical-v2-v19-provider-native-warm-admission.md)
- [Reviewed real-use suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
- [Reviewed real-use evidence](../../../evidence/search/lexical-v2/lexical-v2-reviewed-real-use-projection-v1.md)
