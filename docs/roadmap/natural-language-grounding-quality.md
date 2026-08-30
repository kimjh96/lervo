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

Operational search remains `lexical-v1`. `local-hybrid-v1`, bounded fallback v1, and assisted v2-v7 were rejected. V8 met quality, evidence, and non-token criteria but failed the token ratio because control usage was incomplete. Unchanged v9 passed every pre-registered criterion without activating the candidate. [ADR-0248](../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md) authorized only an effect-free managed-run phase A shadow projection.

The isolated phase-A [pilot v3](../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md) completed 30/30 eligible samples: 30 immutable observations, 24 nonempty projections, exact replay, no privacy failures, exactly 60 provider invocations, and unchanged primary effects. Provider shadow and production effects remained unauthorized.

The passed [v18 four-case relational confirmation](../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md) evaluated bounded cross-provider source selection and completed 32/32 fresh calls without retry. Both providers retained 100% recall in every observation; Codex mean precision was 93.75% and Claude mean precision was 76.04%.

[ADR-0277](../decisions/search/activation/provider-shadow-structured/0277-stage-managed-context-relational-canary.md) fixed a default-off managed-context canary design and authorized implementation and provider-free verification only. Live traffic, managed-context effects, direct-terminal changes, operational-search changes, and production activation required an exact prepared checkpoint over an eligible registered corpus and remained unauthorized. Provider-free fixtures proved the one-turn JSON Schema contract, exact selected-to-loaded-to-injected evidence inputs, owner-only bounded records, conflicting-replay rejection, and zero adapter creations for ineligible coordinates, but not native Codex tool isolation.

[ADR-0278](../decisions/search/activation/provider-shadow-structured/0278-prepare-exact-managed-context-canary-checkpoint.md) prepared, without live traffic, eight reviewed source tasks paired across eight Codex and eight Claude runs, with at most one selection call and one task call per run. Its owner-only manifest bound exact recommendation, source-snapshot, projection, schema, model, and rollback coordinates while retaining zero calls and false execution/effect authority. Live execution remained blocked pending operator authorization of the final manifest digest.

After authorization, [managed-context canary v1](../evidence/search/provider-shadow/linked-evidence-managed-canary-v1.md) stopped on its first Codex selection call because the read-only adapter emitted a forbidden command-execution signal. No selection completed, managed task or Claude call started, or source changed. [ADR-0279](../decisions/search/activation/provider-shadow-structured/0279-stop-managed-context-canary-v1-on-command-signal.md) rejected v1 without retry. The implementation requires effective tool, command, and file-change capabilities all unsupported before candidate injection or a model turn. Provider-free tests stop the current Codex app-server with zero selection turns and permit an empty-tool Claude session.

[ADR-0280](../decisions/search/activation/provider-shadow-structured/0280-add-an-opt-in-codex-responses-no-tool-transport.md) added an opt-in Codex Responses transport with no tools, `tool_choice: "none"`, no storage, and the exact selection schema; ordinary Codex execution remained on app-server. [ADR-0281](../decisions/search/activation/provider-shadow-structured/0281-prepare-managed-context-canary-v2.md) preserved that design in a non-executable 32-call checkpoint, but its separate API credential was not a product activation prerequisite.

[ADR-0282](../decisions/search/activation/provider-shadow-structured/0282-remove-api-key-requirement-from-managed-context-canary.md) removed API keys from the primary experiment path. Provider-free v3 preparation correctly bound passed V18 evidence but retained no added source for Codex and only one for Claude, so [v3](../evidence/search/provider-shadow/linked-evidence-managed-canary-v3.md) was rejected before execution with zero calls.

[ADR-0283](../decisions/search/activation/provider-shadow-structured/0283-prepare-deterministic-linked-context-canary-v4.md) proved every paired run had a nonempty deterministic added-context set. [ADR-0284](../decisions/search/activation/provider-shadow-structured/0284-prepare-exact-deterministic-native-session-canary-v5.md) bound the schema-v2 runtime. [ADR-0285](../decisions/search/activation/provider-shadow-structured/0285-authorize-exact-key-free-managed-canary-v6.md) added exact authorization, attempt-before-call persistence, and fail-first native-session execution. The selection-call ceiling remained zero and the total task-call ceiling 16. V1-v5 remained immutable. Live paired measurement required the exact final v6 manifest digest and no API key.

[Managed canary v11](../evidence/search/provider-shadow/linked-evidence-managed-canary-v11.md) completed eight Codex and eight Claude native-session runs without technical failures, retries, selection calls, API keys, or repository changes. Both providers achieved source recall 1.0. Codex passed the reference-precision gates. Claude mean precision was 0.5014, with three runs below 0.5 because E4 output also marked operational and adjacent context. Activation remained default-off.

[ADR-0291](../decisions/search/activation/provider-shadow-structured/0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md) authorized only a provider-neutral request-side constraint and a fresh v12 paired confirmation, forbidding post-filtering of observed references or disclosure of expected source identifiers. [Managed canary v12](../evidence/search/provider-shadow/linked-evidence-managed-canary-v12.md) completed all 16 fresh runs without technical failure. Claude mean precision improved to 65.97%, but two runs remained below 50%. Codex mean precision improved to 91.67%, but two runs lost one expected source, reducing mean recall to 87.5%. [ADR-0292](../decisions/search/activation/provider-shadow-structured/0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md) rejected and rolled back the prompt-only correction.

[ADR-0293](../decisions/search/activation/provider-shadow-structured/0293-type-task-evidence-and-governance-context.md) completed the provider-neutral typed delivery boundary and common Codex-Claude tests without provider calls. [Managed canary v14](../evidence/search/provider-shadow/linked-evidence-managed-canary-v14.md) completed 16/16 typed runs with full recall for both providers and no technical failure. Codex passed every accuracy gate; Claude mean precision was 60.07%, with two runs below 50%. [ADR-0296](../decisions/search/activation/provider-shadow-structured/typed-context/0296-reject-activation-after-typed-context-managed-canary-v14.md) rejected activation. [ADR-0297](../decisions/search/activation/provider-shadow-structured/typed-context/0297-separate-claim-reference-eligibility-from-task-evidence.md) recorded the provider-neutral diagnosis and added independent claim eligibility while preserving linked supporting context. Provider-free verification and a fresh paired canary had to precede activation; the feature remained default-off.

[ADR-0298](../decisions/search/activation/provider-shadow-structured/typed-context/0298-stop-v15-on-measurement-projection-failure.md) preserved v15 after one post-turn measurement failure and no accepted accuracy sample. The correction exposed only sorted unique canonical E4 document IDs in the existing bounded run summary. A fresh source-current v16 checkpoint had to pass the unchanged 8+8 gates before activation.

[ADR-0299](../decisions/search/activation/provider-shadow-structured/typed-context/0299-stop-v16-and-expand-canary-observation-capacity.md) preserved v16 after 11 accepted results and one post-turn storage-capacity failure. V16 used 12 task calls and zero selection calls but could not support activation because the population was incomplete. The bounded owner-only observation cap increased from 64 to 128 without deleting historical evidence; a fresh source-current v17 had to pass the unchanged 8+8 gates.

[ADR-0300](../decisions/search/activation/provider-shadow-structured/typed-context/0300-stop-v17-and-expand-complete-event-capacity.md) preserved v17 after 10 accepted results and one pre-provider complete-event source failure. V17 used 10 task calls and zero selection calls; the failed run made no provider call. The complete execution-event count cap increased from 4,096 to 8,192 while the 16 MiB byte cap and privacy validation remained unchanged. No event was deleted or truncated; a fresh source-current v18 had to pass the unchanged 8+8 gates.

[Managed canary v18](../evidence/search/provider-shadow/linked-evidence-managed-canary-v18.md) completed all eight Codex and eight Claude source-current runs with zero technical failures, selection calls, retries, API keys, or repository mutations. Both providers achieved 100% recall; Codex mean precision was 83.33% and Claude mean precision was 79.17%, with every run at or above 50%. [ADR-0301](../decisions/search/activation/provider-shadow-structured/typed-context/0301-activate-deterministic-claim-eligible-linked-context.md) activated bounded deterministic linked supporting context for ordinary managed runs without a selection adapter or user configuration.

The subsequent [lexical-only versus linked-context paired evaluation](../evidence/search/paired-uplift/lexical-linked-uplift-v1.md) found no incremental quality uplift. Across 32 Codex and Claude runs, expected-source recall remained 100%, while linked context reduced equal-provider mean claim recall and complete-answer rate by 6.25 percentage points each. Mean duration fell 9.89%, Claude total tokens rose 28.33%, and five task pairs lost quality versus two wins. The source worktree had no registered search documents, so its ordinary linked projection was empty. [ADR-0302](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) retired the ordinary linked default and restored lexical-only operation. The exact canary and historical evidence remain default-off.

[ADR-0305](../decisions/execution/grounding/0305-bind-terminal-grounding-to-native-structured-output.md) corrected direct-terminal grounding without lexical routing. Codex and Claude use provider-native schema binding and low effort inside the unchanged 20-second budget. A non-ready decision performs no search; terminal selection and loading claims derive only from observed selected documents. Fresh-provider verification must prove both adapters can find current relevant publications.

Detailed observations, immutable failures, measurements, and delivery chronology are in the [evaluation history](natural-language-grounding-quality/evaluation-history.md).

## Current boundaries

Operational retrieval is `lexical-v1` unless an engine candidate passes the existing build-bound comparison, review, activation, and resolver chain. Ordinary managed runs add no linked-only context. The exact linked canary remains separately authorized and default-off, and the public CLI has no canary activation input.

The next retrieval improvement should be `lexical-v2` or an external adapter behind the existing `SearchEnginePort` and `SearchIndexPort`, not another post-search exception. Candidate registration remains inert; activation requires paired quality, latency, privacy, and cost evidence with explicit rollback to `lexical-v1`.

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
- Ambiguous references, missing workstreams, stale hashes, absent authority, no sources, and unreviewed graph relations fail closed without invented paths or rationale.
- Invalid provider grounding never selects a workflow, effect, capability, authority, provider, or source. Unmanaged terminal prompts return observable empty abstention instead of blocking; managed consumers reject the failure.
- Direct Codex and Claude grounding completes through native schema binding within the hook budget, and fresh terminal sessions retrieve relevant current publications without keyword, alias, or phrase routing.
- Search, graph recommendation, grounding quality, and managed execution evidence remain separate contracts.
- Empty default projections preserve the ordinary context plan; default and exact-canary deterministic paths create no selection adapter.
- No result upgrades selected, loaded, injected, referenced, or used beyond observed telemetry.
- Relevant tests, quality checks, documentation lifecycle, knowledge refresh, and release-completion review pass.

## References

See [ADR-0224](../decisions/search/0224-natural-language-grounding-quality-evaluation.md), [ADR-0225](../decisions/search/0225-revise-local-hybrid-for-cross-language-recall.md), [ADR-0226](../decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md), [ADR-0238](../decisions/search/0238-evaluate-evidence-gap-lexical-assistance-v2.md), [ADR-0240](../decisions/search/0240-evaluate-catalog-assisted-retrieval-v3.md), [ADR-0241](../decisions/search/0241-evaluate-deterministic-core-term-coverage-v4.md), [ADR-0243](../decisions/search/0243-evaluate-observable-reference-markers-v5.md), [ADR-0244](../decisions/search/0244-evaluate-marker-derived-source-paths-v6.md), [ADR-0245](../decisions/search/0245-evaluate-staged-evidence-selection-v7.md), [ADR-0246](../decisions/search/0246-evaluate-linked-evidence-reconciliation-v8.md), [ADR-0247](../decisions/search/0247-confirm-linked-evidence-reconciliation-v9.md), [ADR-0249](../decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md), [ADR-0250](../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md), and [ADR-0251](../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md).
