# ADR-0459: Measure context hits and usage on every channel

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0413](../../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md), [ADR-0431](../governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md), [ADR-0346](0346-measure-improvement-effects-from-bounded-local-events.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

Amended by: [ADR-0550](../../grounding/0550-measure-find-on-terminal-turns-and-replay-past-changes.md) (a provider-free replay set over past changes), [ADR-0552](../../grounding/0552-check-changes-against-the-canon-that-names-them.md) (miss rate from the governing index)
Amended by: [ADR-0538](../../grounding/0538-find-governing-context-through-exact-prompt-anchors.md), [ADR-0542](../../grounding/0542-observe-native-skill-use-instead-of-repeating-skill-disclosure.md)

## Context

Lervo's differentiator is canonical knowledge delivered at the right moment, with every turn measured. The audit found uneven coverage:

- `lervo run`, supervised workers, Discord read turns, supervision owner reasoning, and deliberation use `ManagedProviderRunCoordinator`, which records `context.recommended`, `context.selected`, `document.loaded`, and `context.injected` (`packages/context-delivery/src/receipt.ts:72-161`). Installed Discord supervision shows `context.injected`.
- Discord repository-work turns (`discord-conversation-repository-work.ts:51-56`, prose instructions only) and knowledge convergence workers (content-hash currency check only) have neither retrieval nor receipts. The Discord semantic-review agent is unwired.
- Lexical v2 is the default on every shipped path (`packages/repository-context/src/product-default-search.ts:20-66`, ADR-0328, ADR-0413); BM25F is only an evaluation candidate. ADR-0413 permits prepared-index reuse only for the exact repository source revision; revision changes invalidate the projection.
- ADR-0451 defaults to compact terminal context: zero recommendations, no provider call, and a pointer to `lervo knowledge query`. Agent-run query hits are unrecorded. Retrieval mode records `terminal.context.prepared`, but injection is hard-coded `unobserved` and use `unknown`.
- `used` is never measured. E4 is the opt-in citation `lervo-e4:<docId>:<sha256>`; `context-coverage` reports `relevance: null` and `internalUse: unsupported`. Precision and recall exist only in scripted canaries: v18 linked-evidence recall was 100 percent and precision 83 and 79 percent; v20 gate precision was 97.5 and 90.8 percent with 21 and 50 percent fewer tokens.
- `resource.usage.recorded` distinguishes `provider_reported` from `lervo_measured` and binds work causality, including `agentId`. Reports group by provider, scope, and source, never agent, channel, or turn. Discord repository-work records no usage; knowledge-worker usage is in CAS artifacts invisible to reports. Owner reasoning has no in-flight cap: one supervised review consumed about 2.6 million tokens without finishing; an earlier run exceeded a 1.5 million ceiling because its reservation was 1,000 tokens.

No reference product has evidence-grade hit or usage measurement; research credits Paperclip with cost warnings and Lervo with distinct evidence states. ADR-0454's open conversation model will raise spend, requiring measurement-driven budgets and pruning.

## Decision

### One receipt and one usage record on every channel

Every provider turn on every surface produces a context receipt containing `selected`, `loaded`, `injected`, and `referenced` document sets and a `resource.usage.recorded` event. Required attribution is `agentId`, `conversationDigest` or null, `channel` (`terminal | managed_run | conversation | supervision | knowledge_worker | deliberation`), `turnEventId`, and `stage`.

Source labels are `provider_reported`, `lervo_measured`, or `estimated`; the Claude adapter's separate estimate event folds into `source: estimated`. Discord repository-work gains retrieval through `prepareManagedSearchContext` and emits both records. Knowledge workers emit `resource.usage.recorded` from existing usage artifacts and a receipt from `loadCanonicalReviewContext`.

A turn missing either record fails its completion gate with `measurement_unavailable`: a core robustness failure, never a quiet default.

### Precise hits without critical-path latency

ADR-0451 remains: the prompt hook adds no provider call and stays under 2 KB. Hits return through a prepared retrieval snapshot:

- The knowledge resident starts a background `terminal-retrieval-preparer`, which prepares a Lexical v2 index for the exact current repository revision. Under ADR-0413, revision changes invalidate it and trigger an off-critical-path rebuild.
- On `UserPromptSubmit`, the hook runs a deterministic query projection without a provider against the prepared index, within 150 ms. It injects at most three document pointers with hashes and records `terminal.context.prepared` with `selected` and `loaded`. An exceeded budget or stale revision yields zero pointers and `retrieval_budget_exceeded`, never a wait.
- Agent-run `lervo knowledge query` records `context.selected` for returned sources against the current turn.
- On `Stop`, reference detection continues to inspect the last assistant message. A new path-mention detector counts quoting a selected document's path as `referenced` without requiring the E4 token.

### Hit quality metrics

`context-coverage` computes three production metrics from receipts and later evidence, reported per channel, agent, and week:

- **Hit precision:** referenced divided by injected.
- **Miss rate:** turns whose repository change or reply touched an unselected canonical document, detected through changed paths and path mentions.
- **Stale-hit rate:** injected documents whose hash changed between selection and injection, or whose knowledge record was superseded.

Production ground-truth relevance remains unavailable; label these metrics as proxies. The v20 paired-gate thresholds become the preparer's regression floor.

### Measured usage drives budgets and pruning

- **Per-conversation hourly token budget:** default from the operating mandate and surfaced in the room. The turn report shows turn and hourly tokens. At 80 percent, the responder trims secondary fan-out (ADR-0454) to zero. At 100 percent, new agent-initiated turns wait with one notice.
- **In-flight cap for owner reasoning and every supervised run:** apply `provider_token_limit_exceeded` to owner reasoning with a reservation no lower than `maximumAttemptTokens`. Stop a run that cannot report usage within its first stage with `usage_unobserved`.
- **Tokens per successful outcome:** the roadmap's primary cost metric, computed from `autonomy.cycle.completed`, `conversation.repository_work.completed`, and verification events.
- **Context pruning:** when a channel's hit precision stays below 0.5 for a week, lower its preparer `finalLimit` by one, bounded at three. When precision exceeds 0.8 and miss rate exceeds 0.1, raise it by one, bounded at ten. Record changes and make them reversible.

### Turn report

Every surface renders one line per turn from the same projection: selected and referenced documents, turn and hourly tokens, and budget state. Discord uses a result footer; the CLI prints it after `lervo run`; the compact prompt shows only the hourly figure.

## Events, states, and failure meaning

- `resource.usage.recorded` gains required `channel`, `turnEventId`, and `conversationDigest`, and accepts `estimated` as a `source` value. Readers tolerate missing fields on historical events.
- `terminal.context.prepared` gains `preparedIndexRevision`, `queryBudgetMs`, and `disposition` (`hits | no_hits | retrieval_budget_exceeded | stale_revision`).
- `context.selected` gains `origin: hook | agent_query | managed_turn`.
- `context.metrics.projected`: `window`, `channel`, `agentId` or null, `hitPrecision`, `missRate`, `staleHitRate`, `tokensPerOutcome`, `turnCount`, `occurredAt`.
- `context.pruning.adjusted`: `channel`, `previousFinalLimit`, `finalLimit`, `reason`, `occurredAt`.
- Failure codes: `measurement_unavailable`, `retrieval_budget_exceeded`, `usage_unobserved`, `conversation_budget_exhausted`.

Privacy: receipts and usage carry document ids, hashes, counts, and identifiers; never query text, prompts, or outputs.

## Migration

1. Add attribution fields and repository-work and knowledge-worker records; backfill nothing.
2. Ship the preparer behind the knowledge resident; retain `LERVO_TERMINAL_CONTEXT=retrieval` as full-document mode.
3. Enable metrics projection and the turn report; observe four weeks before any pruning adjustment.
4. Enable the per-conversation budget with ADR-0454 fan-out.

## Acceptance (installed)

- Every audited channel produces both records on a real turn; `measurement_unavailable` never fires during a week of fleet operation.
- A compact-mode Claude Code prompt shows up to three pointers within 150 ms, with a later `referenced` record for a quoted document.
- Weekly metrics appear for terminal, conversation, supervision, and knowledge channels; the J1 result footer shows hits and tokens.
- An owner-reasoning run exceeding its reservation stops in flight and records the stop.
- Tokens per successful outcome is reported for one standing goal over seven days.

## Deferred

Ground-truth relevance labelling, monetary cost, and cross-repository usage aggregation.

## References

- [Stage observation and performance](../../../../specifications/execution/stage-observation-and-performance.md)
- [Linked-evidence measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
- [ADR-0318 v20 qualification](../../../search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Paperclip comparison: capabilities and gaps](../../../../research/paperclip-lervo-comparison/capabilities-and-gaps.md)

[ADR-0541](../../grounding/0541-bind-agent-queries-to-the-turn-and-observe-path-references.md) binds agent-run `lervo knowledge query` selections to the single open turn and records `path_mention` references at `Stop` for hook pointers and agent query results.
