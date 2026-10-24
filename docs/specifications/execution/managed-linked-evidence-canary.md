# Managed Linked-Evidence Canary

Status: `historical_experiment`
As of: 2026-08-30
Removed by: [ADR-0528](../../decisions/search/activation/0528-remove-the-linked-evidence-canary-and-shadow.md). The canary and shadow no longer exist in the product; this specification records what they did.

## Authorization and delivery

`linked-evidence-managed-canary-v1` remains an exact-authorized, default-off experimental path. Before adapter creation, an eligible run binds the canary, project, run, provider arm, lexical recommendation batch, source snapshot, selection attempt, call ceiling, and explicit managed-context effect authority. It validates at most eight one-hop registered sources and 117,813 candidate bytes. Only exact-hash selections enter the ordinary context plan. Authorization mismatches fail before provider creation. The public CLI exposes no canary authorization input.

`managed-linked-evidence-default-v1` is retired by ADR-0302. Without exact canary authorization, an ordinary managed run performs no linked projection, selection, load, or injection. Operational retrieval remains `lexical-v1` unless a separately reviewed search-engine transition selects another registered engine. The dependency-injected paired-evaluation executor is not part of default application composition.

The primary paired task path requires no user API keys. Provider-free v3 preparation showed that passed V18 selections mostly referred to sources already in ordinary context and rejected that checkpoint before execution. V4 proved a nonempty deterministic all-current-candidate population. V5 bound the implemented schema-v2 runtime; v6 freshly binds the later exact-authorization and fail-first execution operation. It selects every exact current bounded linked candidate in projection order, creates no selection adapter, and uses the ordinary Codex or Claude native signed-in task adapter. Preparation and selection make zero provider calls; the paired task ceiling is 16 calls. The selection-only Codex Responses transport remains optional internal BYOK behavior, not a product-activation prerequisite.

Deterministic selection is current E1 evidence; reload, injection, and final reference remain separate E2–E4 evidence. Selection, loading, injection, and use claims remain distinct. Expected evaluation document identifiers remain hidden from providers, and observations are never post-filtered against them.

V12 rejected a prompt-only distinction between substantive task evidence and behavior or governance context: Claude retained two per-run precision failures, while Codex introduced two recall failures. ADR-0293 implements the required typed boundary: canary protocols are `governance_context`, linked candidates are `task_evidence`, and E3 receipts must preserve each role.

ADR-0294 prepared v13 with the unchanged v12 population and gates. Its reviewed contract binds the typed-boundary source bytes and v12 rollback evidence; its owner-only manifest binds the exact repository snapshot, built CLI, schedule, and default-off predecessor. The preparation entrypoint exposes only `prepare` and `status`. It records a later-review ceiling of eight Codex and eight Claude native-session tasks but authorizes zero provider calls or managed-context effects.

ADR-0295 accepted the user's explicit execution direction through a fresh v14 source/build checkpoint because authorization added after v13 made the immutable v13 snapshot stale. V14 preserved the v13 population and gates, bound the existing exact-manifest authorization and fail-first execution sources, persisted one attempt before each sequential task, and revalidated source and build before every call. Its ceiling was eight Codex and eight Claude task calls. Selection calls, API keys, retries, writes, and activation remained prohibited.

V14 completed all 16 authorized task calls without technical failure or repository mutation. Both providers achieved 100% recall. Codex passed at 87.5% mean precision; Claude reached 60.07% and failed two per-run precision gates. ADR-0296 preserves the terminal negative observation set, rejects activation, and requires a provider-neutral diagnosis of task-evidence eligibility before another provider call.

ADR-0297 separates task classification from claim authority. Direct task evidence has `referenceEligible: true`; an `explicit_link`-only source remains selected, loaded, and injected task evidence but has `referenceEligible: false`. Direct provenance wins when both occur, and governance is always false. Only eligible task evidence receives an E4 token. A diagnostic counterfactual over immutable v14 observations identified this boundary without rescoring or altering v14. Provider-free common-contract verification is required before a fresh source-current paired canary. Activation remains default-off until all unchanged gates pass.

V15 stopped after its first Codex provider turn because the measurement adapter read E4 from a property absent from the bounded managed-run outcome. It persisted one technical failure, one task call, zero selection calls, no retry, and no accepted accuracy sample. ADR-0298 preserves v15 as immutable and derives sorted unique reference IDs from canonical E4 into the existing privacy-bounded search summary before a fresh v16 checkpoint. Activation remains default-off.

V16 stopped after 11 accepted results when its twelfth provider turn completed but the isolated repository's managed-canary store reached its 64-record cap. The failed turn is technical overhead, not an accuracy sample; v16 is not resumed or retried. ADR-0299 raises the owner-only derived observation cap to 128 without deleting historical records and requires a fresh v17 population. The cap permits four additional 16-run populations from the observed 64-record baseline; reaching it still fails closed with `observation_limit_exceeded`. Activation remains default-off until the fresh population passes.

V17 stopped after 10 accepted results when the next run's pre-provider context preparation observed 4,105 relevant execution events above the complete-event source cap of 4,096. The failed run used no provider call and is not an accuracy sample. ADR-0300 raises the count cap to 8,192 while preserving the independent 16 MiB byte cap, complete-chain integrity checks, event privacy allowlist, and fail-closed behavior. No event is deleted or truncated. A fresh v18 binds the observed 74 of 128 canary records and 4,105 of 8,192 relevant events before executing the unchanged population.

V18 completed all 16 fresh runs without technical failure, selection call, API key, retry, or repository mutation. Both providers achieved 100% recall. Codex achieved 83.33% mean and 66.67% minimum precision; Claude achieved 79.17% mean and 50% minimum precision. Every unchanged gate passed. ADR-0301 activated the deterministic path for ordinary managed Codex and Claude runs while preserving the exact canary and all historical evidence. A later paired lexical-only comparison found quality regressions, so ADR-0302 retired that ordinary activation. The exact canary remains default-off historical infrastructure.

## Evidence and privacy

Each prepared run stores at most one immutable owner-only record under `.lervo/state/search/linked-evidence-managed-canary/`; the collection stops at 128 records. Records retain only allowlisted run and adapter identifiers, stage counts and digests, bounded byte counts, duration, provider-reported usage totals, terminal status, and an ADR-0277 failure code.

Schema v2 names the selection policy as `provider_turn` or `deterministic_policy`, keeps total candidate bytes separate from provider-visible selection bytes, and permits a null selection adapter receipt and null selection usage only for a completed deterministic selection. Preserved schema-v1 records remain valid provider-turn evidence.

Records exclude requests, prompts, paths, titles, link text, source and result bodies, credentials, absolute paths, and unrestricted provider errors. Conflicting replay, incomplete E1–E4 coordinates, storage failure, and source drift fail closed without retry or baseline fallback.

## References

- [Execution and evidence specification](../execution.md)
- [Provider adapter specification](provider-adapters.md)
- [ADR-0277](../../decisions/search/activation/provider-shadow-structured/0277-stage-managed-context-relational-canary.md)
- [ADR-0284](../../decisions/search/activation/provider-shadow-structured/0284-prepare-exact-deterministic-native-session-canary-v5.md)
- [ADR-0285](../../decisions/search/activation/provider-shadow-structured/0285-authorize-exact-key-free-managed-canary-v6.md)
- [ADR-0291](../../decisions/search/activation/provider-shadow-structured/0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md)
- [ADR-0292](../../decisions/search/activation/provider-shadow-structured/0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md)
- [ADR-0293](../../decisions/search/activation/provider-shadow-structured/0293-type-task-evidence-and-governance-context.md)
- [ADR-0294](../../decisions/search/activation/provider-shadow-structured/0294-prepare-typed-context-managed-canary-v13.md)
- [ADR-0295](../../decisions/search/activation/provider-shadow-structured/typed-context/0295-authorize-typed-context-managed-canary-v14.md)
- [ADR-0296](../../decisions/search/activation/provider-shadow-structured/typed-context/0296-reject-activation-after-typed-context-managed-canary-v14.md)
- [ADR-0297](../../decisions/search/activation/provider-shadow-structured/typed-context/0297-separate-claim-reference-eligibility-from-task-evidence.md)
- [ADR-0298](../../decisions/search/activation/provider-shadow-structured/typed-context/0298-stop-v15-on-measurement-projection-failure.md)
- [ADR-0299](../../decisions/search/activation/provider-shadow-structured/typed-context/0299-stop-v16-and-expand-canary-observation-capacity.md)
- [ADR-0300](../../decisions/search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md)
- [ADR-0301](../../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md)
- [ADR-0302](../../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
