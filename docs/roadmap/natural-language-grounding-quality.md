# Natural-language grounding quality

Status: `active`
Started: 2026-08-27

## Objective

Validate practical Korean and mixed-language repository requests while keeping search ranking, conversational grounding, approval authority, and evidence of use distinct. Production uses typed same-provider semantic grounding. Lexical scoring retrieves candidates and may precede bounded autonomous inspection. Rejected experiments have no routing authority.

## Evaluation contract

| Layer | Input | Required output | Activation authority |
| --- | --- | --- | --- |
| Engine retrieval | One deterministic query and reviewed expected paths | Top-10 success, recall, reciprocal rank, and per-task comparison | None; observation only |
| Conversational grounding | Prompt, bounded prior turns, workstream availability, authority, and repository condition | Separate intent, reference, source-class, disposition, required-behavior, and prohibited-behavior verdicts | None; observation only |
| Managed execution evidence | Canonical run and context events | Selected, loaded, injected, referenced, and missing stages without inferred use | Existing execution policy only |

The matrix contains 20 Korean-framed cases and 20 one-to-one English controls across four task types, exactly five per type. It also contains 32 grounding cases across eight categories, exactly four per category. Coverage includes positive, ambiguous, abstention, stale-binding, no-source, and unreviewed-relation cases; context-dependent dispositions for identical prompts; public fixture text; digest-only runtime events; and report redaction.

Initial suites remain `verification_authored` and `pending_human_review`. They cannot authorize hybrid activation or establish production representativeness.

## Current state

Operational search was `lexical-v1` through the experiments below. `local-hybrid-v1`, bounded fallback v1, and assisted v2-v7 were rejected. V8 met quality, evidence, and non-token criteria but failed its token-ratio gate because control usage was incomplete. Unchanged v9 passed every preregistered criterion without activation. [ADR-0248](../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md) authorized only effect-free managed-run phase-A shadow projection.

The isolated phase-A [pilot v3](../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md) completed all 30 eligible samples: 30 immutable observations, 24 nonempty projections, exact replay, no privacy failures, exactly 60 provider invocations, and unchanged primary effects. Provider shadow and production effects remained unauthorized.

The [v18 four-case relational confirmation](../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md) completed 32/32 fresh cross-provider source-selection calls without retry. Both providers retained 100% recall in every observation; mean precision was 93.75% for Codex and 76.04% for Claude.

[ADR-0277](../decisions/search/activation/provider-shadow-structured/0277-stage-managed-context-relational-canary.md) fixed a default-off managed-context canary and authorized only implementation and provider-free verification. Live traffic, managed-context effects, direct-terminal changes, operational-search changes, and production activation required an exact prepared checkpoint over an eligible registered corpus. Provider-free fixtures proved the one-turn JSON Schema contract, exact selected-to-loaded-to-injected evidence inputs, owner-only bounded records, conflicting-replay rejection, and zero adapter creations for ineligible coordinates, but not native Codex tool isolation.

[ADR-0278](../decisions/search/activation/provider-shadow-structured/0278-prepare-exact-managed-context-canary-checkpoint.md) prepared, without live traffic, eight reviewed source tasks paired across eight Codex and eight Claude runs, with at most one selection call and one task call per run. Its owner-only manifest bound exact recommendation, source-snapshot, projection, schema, model, and rollback coordinates while retaining zero calls and false execution/effect authority. Live execution remained blocked pending operator authorization of the final manifest digest.

After authorization, [managed-context canary v1](../evidence/search/provider-shadow/linked-evidence-managed-canary-v1.md) stopped on its first Codex selection call because the read-only adapter emitted a forbidden command-execution signal. No selection completed, managed task or Claude call started, or source changed. [ADR-0279](../decisions/search/activation/provider-shadow-structured/0279-stop-managed-context-canary-v1-on-command-signal.md) rejected v1 without retry. The implementation requires effective tool, command, and file-change capabilities all unsupported before candidate injection or a model turn. Provider-free tests stop the current Codex app-server with zero selection turns and permit an empty-tool Claude session.

[ADR-0280](../decisions/search/activation/provider-shadow-structured/0280-add-an-opt-in-codex-responses-no-tool-transport.md) added an opt-in Codex Responses transport with no tools, `tool_choice: "none"`, no storage, and the exact selection schema; ordinary Codex execution remained on app-server. [ADR-0281](../decisions/search/activation/provider-shadow-structured/0281-prepare-managed-context-canary-v2.md) preserved the design in a non-executable 32-call checkpoint, but its separate API credential was not a product activation prerequisite.

[ADR-0282](../decisions/search/activation/provider-shadow-structured/0282-remove-api-key-requirement-from-managed-context-canary.md) removed API keys from the primary experiment path. Provider-free v3 preparation correctly bound passed V18 evidence but retained no added source for Codex and only one for Claude, so [v3](../evidence/search/provider-shadow/linked-evidence-managed-canary-v3.md) was rejected before execution with zero calls.

[ADR-0283](../decisions/search/activation/provider-shadow-structured/0283-prepare-deterministic-linked-context-canary-v4.md) proved every paired run had a nonempty deterministic added-context set. [ADR-0284](../decisions/search/activation/provider-shadow-structured/0284-prepare-exact-deterministic-native-session-canary-v5.md) bound the schema-v2 runtime. [ADR-0285](../decisions/search/activation/provider-shadow-structured/0285-authorize-exact-key-free-managed-canary-v6.md) added exact authorization, attempt-before-call persistence, and fail-first native-session execution. The selection-call ceiling remained zero and the total task-call ceiling 16. V1-v5 remained immutable. Live paired measurement required the exact final v6 manifest digest and no API key.

[Managed canary v11](../evidence/search/provider-shadow/linked-evidence-managed-canary-v11.md) completed eight Codex and eight Claude native-session runs without technical failures, retries, selection calls, API keys, or repository changes. Both providers achieved source recall 1.0. Codex passed the reference-precision gates. Claude mean precision was 0.5014; three runs fell below 0.5 because E4 output also marked operational and adjacent context. Activation remained default-off.

[ADR-0291](../decisions/search/activation/provider-shadow-structured/0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md) authorized only a provider-neutral request-side constraint and fresh v12 paired confirmation. Post-filtering observed references and disclosing expected source identifiers were forbidden. [Managed canary v12](../evidence/search/provider-shadow/linked-evidence-managed-canary-v12.md) completed all 16 fresh runs without technical failure. Claude mean precision improved to 65.97%, but two runs remained below 50%. Codex mean precision improved to 91.67%, but two runs lost one expected source, reducing mean recall to 87.5%. [ADR-0292](../decisions/search/activation/provider-shadow-structured/0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md) rejected and rolled back the prompt-only correction.

[ADR-0293](../decisions/search/activation/provider-shadow-structured/0293-type-task-evidence-and-governance-context.md) completed the provider-neutral typed-delivery boundary and common Codex-Claude tests without provider calls. [Managed canary v14](../evidence/search/provider-shadow/linked-evidence-managed-canary-v14.md) completed 16/16 typed runs with full recall for both providers and no technical failure. Codex passed every accuracy gate; Claude mean precision was 60.07%, with two runs below 50%. [ADR-0296](../decisions/search/activation/provider-shadow-structured/typed-context/0296-reject-activation-after-typed-context-managed-canary-v14.md) rejected activation. [ADR-0297](../decisions/search/activation/provider-shadow-structured/typed-context/0297-separate-claim-reference-eligibility-from-task-evidence.md) recorded the provider-neutral diagnosis and added independent claim eligibility while preserving linked supporting context. Provider-free verification and a fresh paired canary had to precede activation; the feature remained default-off.

[ADR-0298](../decisions/search/activation/provider-shadow-structured/typed-context/0298-stop-v15-on-measurement-projection-failure.md) preserved v15 after one post-turn measurement failure and no accepted accuracy sample. The correction exposed only sorted, unique canonical E4 document IDs in the existing bounded run summary. A fresh source-current v16 checkpoint had to pass the unchanged 8+8 gates before activation.

[ADR-0299](../decisions/search/activation/provider-shadow-structured/typed-context/0299-stop-v16-and-expand-canary-observation-capacity.md) preserved v16 after 11 accepted results and one post-turn storage-capacity failure. V16 used 12 task calls and zero selection calls but could not support activation because the population was incomplete. The bounded owner-only observation cap increased from 64 to 128 without deleting historical evidence; a fresh source-current v17 had to pass the unchanged 8+8 gates.

[ADR-0300](../decisions/search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md) preserved v17 after 10 accepted results and one pre-provider complete-event source failure. V17 used 10 task calls and zero selection calls; the failed run made no provider call. The complete execution-event count cap increased from 4,096 to 8,192 while the 16 MiB byte cap and privacy validation remained unchanged. No event was deleted or truncated; a fresh source-current v18 had to pass the unchanged 8+8 gates.

[Managed canary v18](../evidence/search/provider-shadow/linked-evidence-managed-canary-v18.md) completed all eight Codex and eight Claude source-current runs with zero technical failures, selection calls, retries, API keys, or repository mutations. Both providers achieved 100% recall; mean precision was 83.33% for Codex and 79.17% for Claude, with every run at or above 50%. [ADR-0301](../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md) activated bounded deterministic linked supporting context for ordinary managed runs without a selection adapter or user configuration.

The [lexical-only versus linked-context paired evaluation](../evidence/search/paired-uplift/lexical-linked-uplift-v1.md) found no incremental quality uplift. Across 32 Codex and Claude runs, expected-source recall remained 100%, while linked context reduced equal-provider mean claim recall and complete-answer rate by 6.25 percentage points each. Mean duration fell 9.89%, Claude total tokens rose 28.33%, and five task pairs lost quality versus two wins. The source worktree had no registered search documents, so ordinary linked projection was empty. [ADR-0302](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) retired the ordinary linked default and restored lexical-only operation. The exact canary and historical evidence remain default-off.

[ADR-0305](../decisions/execution/grounding/0305-bind-terminal-grounding-to-native-structured-output.md) corrected typed provider grounding without lexical routing. [ADR-0327](../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md) later removed that effect-grounding call from direct unmanaged prompt preparation. The direct hook now uses only provider-neutral current-repository query projection, grants no effect or authority, materializes no durable rule, and preserves provider availability on internal preparation failure. Terminal selection and loading claims still derive only from observed selected documents.

Detailed immutable failures, observations, measurements, and delivery chronology are in the [evaluation history](natural-language-grounding-quality/evaluation-history.md).

## Current retrieval work

The first [lexical-v2 local and provider comparison](../evidence/search/lexical-v2/lexical-v2-local-and-provider-comparison-v1.md) completed. Local aggregate ranking and warm-query latency improved, but the candidate missed the existing per-task quality threshold and had builds about 2.3 times slower. Codex preserved answer pass count and recall but used 0.55% more reported tokens and 9.26% more time while precision fell slightly. Claude result framing left usage and quality incomplete. [ADR-0307](../decisions/search/engines/0307-revise-lexical-v2-after-local-and-provider-evaluation.md) rejected activation and separated common structured output, section-scoped evidence efficiency, and multilingual retrieval work.

The strengthened [v12 confirmation](../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v12.md) passed augmented English and Korean local-quality gates, preserved all original cases, and reduced candidate evidence bytes to 37.65% of baseline. A final Korean rerun exceeded the unchanged build-p95 cost bound. Codex improved tokens, recall, and precision but failed one new case and the unchanged duration ratio. Claude improved measured efficiency and retrieval metrics but failed the common zero-tool contract because native structured output appeared as tool activity. [ADR-0309](../decisions/search/engines/0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md) retained lexical-v1; a successor required a newly preregistered confirmation, not a retry or weaker gate.

The successor [v20 confirmation](../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md) increased the preregistered sample to five repetitions and proportionally raised the observation floor after retaining a v19 Codex duration failure. From one matching suite and corpus digest, Codex and Claude each completed 120 calls without retries. Both candidates passed 60/60 observations and all 12 cases every repetition with 100% recall, at least 90.83% precision, no provider, contract, or tool failures, and the unchanged token, duration, and byte gates. [ADR-0318](../decisions/search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md) made the build eligible for authorized activation review. It did not synthesize the required human review or repository transition; `lexical-v1` remained the no-transition default and rollback engine.

The exact four-query [reviewed real-use suite](../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json) is bound to explicit user approval and cannot be trimmed or replaced. After the ADR-0319 failure, a provider-neutral projection port and deterministic independent-query fusion corrected the boundary without query-specific aliases or weaker thresholds. Fresh five-repetition runs passed lexical-v2 20/20 for Codex and 20/20 for Claude on the same 455-document corpus; all usage was observed and no projection failed. ADR-0320 accepted that retrieval evidence without manufacturing an engine transition. [ADR-0321](../decisions/search/engines/0321-activate-lexical-v2-through-retrieval-plan-selection.md) closes the gap with a content-bound complete-plan bundle, independent immutable selection and rollback chain, current-corpus validation, selected-engine execution, and fail-closed terminal routing.

## Current boundaries

Keep current ports for deterministic single-engine compatibility. A bounded `retrieve -> optional fuse -> optional rerank` plan above them supports `lexical-v2`, external-only replacement, local-plus-external augmentation, and external reranking without hiding stages or creating another post-search exception. Candidate registration is inert; activation requires paired quality, latency, privacy, and cost evidence with explicit rollback to `lexical-v1`. This follows [ADR-0306](../decisions/search/engines/0306-separate-search-engine-replacement-and-composition.md).

Keep `bm25f-v1` as a control. The first `lexical-v2` experiment combines field-aware Unicode word ranking, identifier-aware splitting, character n-gram retrieval, and deterministic rank fusion. Compare all three local arms on the same current corpus and reviewed Korean, English, mixed-language, exact-identifier, morphology, multi-source, ambiguous-neighbor, and no-hit cases before implementing an external replacement prototype. Augmentation and reranking are separate later candidates; reranking cannot repair first-stage recall.

No stage may:

- Treat shadow-selected, loaded, injected, hook-prepared, or output-referenced bodies as provider use.
- Add fixture-specific term limits or fixed sources.
- Rely on provider completeness declarations.
- Introduce question-category routing.
- Relax thresholds or infer completeness from confidence.
- Silently activate managed provider calls.

Human-reviewed ground truth is required for provenance promotion, production-quality claims, or activation. Human review does not gate negative diagnosis or ordinary engineering work without bulk fixture approval.

## Completion criteria

- Every suite passes the repository validator and focused negative tests.
- Paired reports bind the same corpus digest and disclose the English-dominant corpus limit.
- Human-reviewed cases contain real lexical failures for every task type; synthetic success cannot substitute.
- Grounding reports intent, reference, source class, and disposition separately.
- Managed ambiguous references, missing workstreams, stale hashes, absent authority, no sources, and unreviewed graph relations fail closed without invented paths or rationale. Direct root-session lifecycle gaps remain observable but do not block provider completion.
- Invalid provider grounding never selects a workflow, effect, capability, authority, provider, or source. Managed consumers reject the failure.
- Direct Codex and Claude hooks retrieve relevant current-repository publications through provider-neutral query projection without effect grounding, keyword, alias, translation, or phrase routing. Empty or failed local retrieval never supports an absence claim about another repository or service, and internal preparation failure returns empty success without evidence.
- Search, graph recommendation, grounding quality, and managed execution evidence remain separate contracts.
- Retrieval plans expose every retrieve, fusion, and rerank stage with exact adapter, configuration, input, bound, result, privacy, duration, and failure coordinates; no stage is hidden inside another adapter.
- An activated plan revalidates its tracked bundle, current corpus snapshot and digest, projector population, retriever build, fusion policy, and rollback target before every terminal retrieval; any mismatch fails closed.
- External-only, augmentation, and reranking modes are distinct reviewed plan identities. Required-stage failure never triggers silent omission, engine mixing, stale-index use, or fallback.
- Third-party search adapters are installed and content-locked out of process; queries never dynamically load arbitrary modules, paths, packages, or URLs.
- Empty default projections preserve the ordinary context plan; default and exact-canary deterministic paths create no selection adapter.
- No result upgrades selected, loaded, injected, referenced, or used beyond observed telemetry.
- Relevant tests, quality checks, documentation lifecycle, knowledge refresh, and release-completion review pass.

## References

See [ADR-0224](../decisions/search/0224-natural-language-grounding-quality-evaluation.md), [ADR-0225](../decisions/search/0225-revise-local-hybrid-for-cross-language-recall.md), [ADR-0226](../decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md), [ADR-0238](../decisions/search/0238-evaluate-evidence-gap-lexical-assistance-v2.md), [ADR-0240](../decisions/search/0240-evaluate-catalog-assisted-retrieval-v3.md), [ADR-0241](../decisions/search/0241-evaluate-deterministic-core-term-coverage-v4.md), [ADR-0243](../decisions/search/0243-evaluate-observable-reference-markers-v5.md), [ADR-0244](../decisions/search/0244-evaluate-marker-derived-source-paths-v6.md), [ADR-0245](../decisions/search/0245-evaluate-staged-evidence-selection-v7.md), [ADR-0246](../decisions/search/0246-evaluate-linked-evidence-reconciliation-v8.md), [ADR-0247](../decisions/search/0247-confirm-linked-evidence-reconciliation-v9.md), [ADR-0249](../decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md), [ADR-0250](../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md), and [ADR-0251](../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md).
