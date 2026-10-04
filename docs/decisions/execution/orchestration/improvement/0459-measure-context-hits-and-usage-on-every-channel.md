# ADR-0459: Measure context hits and usage on every channel

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0413](../../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md), [ADR-0431](../governed-work/owner-recovery/0431-fence-repeated-preflight-and-owner-spend.md), [ADR-0346](0346-measure-improvement-effects-from-bounded-local-events.md)
Part of: [ADR-0452 open collaboration platform](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

Lervo's differentiator is not only canonical knowledge; it is that the right canonical document hits at the right moment and that every turn is measured. The audit found the machinery present but uneven:

- Context delivery is wired for `lervo run`, supervised worker runs, Discord read turns, supervision owner reasoning, and deliberation, all through `ManagedProviderRunCoordinator`, which records `context.recommended`, `context.selected`, `document.loaded`, and `context.injected` (`packages/context-delivery/src/receipt.ts:72-161`). Installed Discord supervision shows `context.injected`.
- Two production paths have no receipt and no retrieval: Discord repository-work turns (`discord-conversation-repository-work.ts:51-56`, prose instructions only) and the knowledge convergence workers (content-hash currency check only). The Discord semantic-review agent is unwired.
- Lexical v2 is the product default on every shipped path (`packages/repository-context/src/product-default-search.ts:20-66`, ADR-0328, ADR-0413); BM25F is only an evaluation candidate. ADR-0413 constrains reuse: "reuses the prepared index only for the exact repository source revision. Revision changes invalidate the projection."
- ADR-0451 made the compact terminal context the default: zero recommendations, no provider call, a pointer to `lervo knowledge query`. Hits from that agent-run query are never recorded. Retrieval mode records `terminal.context.prepared` but injection is hard-coded `unobserved` and use `unknown`.
- `used` is never measured. E4 is the opt-in citation `lervo-e4:<docId>:<sha256>`; `context-coverage` reports `relevance: null` and `internalUse: unsupported`. Precision and recall exist only in scripted canaries (v18 linked-evidence: recall 100 percent, precision 83 and 79 percent; v20 gate: precision 97.5 and 90.8 percent with 21 and 50 percent fewer tokens).
- `resource.usage.recorded` distinguishes `provider_reported` from `lervo_measured` and binds work causality including `agentId`, but reports group by provider, scope, and source, never by agent, channel, or turn. Discord repository-work turns record no usage; knowledge workers store usage in CAS artifacts invisible to the report. Owner reasoning has no in-flight cap; one supervised review consumed about 2.6 million tokens without finishing, and an earlier run overran a 1.5 million ceiling because the reservation was 1,000 tokens.

No reference product has evidence-grade hit or usage measurement; the research credits Paperclip with cost warnings and Lervo with distinct evidence states. The open conversation model of ADR-0454 will raise spend, so measurement must drive budgets and pruning.

## Decision

### One receipt and one usage record on every channel

Every provider turn on every surface produces a context receipt with `selected`, `loaded`, `injected`, and `referenced` document sets and a `resource.usage.recorded` event. Attribution fields become required: `agentId`, `conversationDigest` or null, `channel` (`terminal | managed_run | conversation | supervision | knowledge_worker | deliberation`), `turnEventId`, and `stage`. Source labels are `provider_reported`, `lervo_measured`, or `estimated`; the Claude adapter's separate estimate event folds into `source: estimated`. Discord repository-work turns gain retrieval through `prepareManagedSearchContext` and emit both records; knowledge workers emit `resource.usage.recorded` from their existing usage artifacts and a receipt from `loadCanonicalReviewContext`. A turn missing either record fails its completion gate with `measurement_unavailable`, which is a core robustness failure, not a quiet default.

### Precise hits without critical-path latency

ADR-0451 stays: the prompt hook adds no provider call and stays under 2 KB. Hits return through a **prepared retrieval snapshot**:

- A background `terminal-retrieval-preparer`, started by the knowledge resident, keeps a Lexical v2 index prepared for the exact current repository revision, honouring ADR-0413: a revision change invalidates and rebuilds off the critical path.
- On `UserPromptSubmit`, the hook runs a deterministic query projection (no provider) against the prepared index with a 150 ms budget and injects at most three document pointers with hashes, recording `terminal.context.prepared` with `selected` and `loaded`. Over budget or stale revision yields zero pointers and `retrieval_budget_exceeded`, never a wait.
- When the agent runs `lervo knowledge query`, the command records `context.selected` for the returned sources against the current turn, so agent-run hits are measured.
- On `Stop`, reference detection runs on the last assistant message as today, extended with a path-mention detector so that quoting a selected document's path counts as `referenced` even without the E4 token.

### Hit quality metrics

`context-coverage` gains three production metrics computed from receipts and later evidence, reported per channel, agent, and week:

- **Hit precision**: referenced divided by injected.
- **Miss rate**: turns whose repository change or reply touched a canonical document that was not selected, detected from changed paths and path mentions.
- **Stale-hit rate**: injected documents whose hash changed between selection and injection, or whose knowledge record was superseded.

Ground-truth relevance remains unavailable in production; these are proxies and are labelled as such. The v20 paired-gate thresholds become the regression floor for the preparer.

### Measured usage drives budgets and pruning

- **Per-conversation hourly token budget** (default from the operating mandate, surfaced in the room): the turn report shows tokens for the turn and the hour; at 80 percent the responder trims secondary fan-out (ADR-0454) to zero; at 100 percent new agent-initiated turns wait with one notice.
- **In-flight cap for owner reasoning and every supervised run**: `provider_token_limit_exceeded` applies to owner reasoning with a reservation no lower than `maximumAttemptTokens`; a run that cannot report usage within its first stage is stopped with `usage_unobserved`.
- **Tokens per successful outcome** is the roadmap's primary cost metric, computed from `autonomy.cycle.completed`, `conversation.repository_work.completed`, and verification events.
- **Context pruning**: when a channel's hit precision falls below 0.5 for a week, the preparer lowers `finalLimit` for that channel by one, bounded at three; when precision exceeds 0.8 and miss rate exceeds 0.1, it raises it by one, bounded at ten. Changes are recorded and reversible.

### Turn report

Every surface renders one line per turn from the same projection: documents selected and referenced, tokens for the turn and the hour, and budget state. Discord shows it as a footer on the result; the CLI prints it after `lervo run`; the compact prompt shows the hourly figure only.

## Events, states, and failure meaning

- `resource.usage.recorded` gains required `channel`, `turnEventId`, `conversationDigest`, and `estimated` as a `source` value; readers tolerate absence on historical events.
- `terminal.context.prepared` gains `preparedIndexRevision`, `queryBudgetMs`, and `disposition` (`hits | no_hits | retrieval_budget_exceeded | stale_revision`).
- `context.selected` gains `origin: hook | agent_query | managed_turn`.
- `context.metrics.projected`: `window`, `channel`, `agentId` or null, `hitPrecision`, `missRate`, `staleHitRate`, `tokensPerOutcome`, `turnCount`, `occurredAt`.
- `context.pruning.adjusted`: `channel`, `previousFinalLimit`, `finalLimit`, `reason`, `occurredAt`.
- Failure codes: `measurement_unavailable`, `retrieval_budget_exceeded`, `usage_unobserved`, `conversation_budget_exhausted`.

Privacy: receipts and usage carry document ids, hashes, counts, and identifiers; never query text, prompts, or outputs.

## Migration

1. Add attribution fields and the repository-work and knowledge-worker records; backfill nothing.
2. Ship the preparer behind the knowledge resident; keep `LERVO_TERMINAL_CONTEXT=retrieval` as the full-document mode.
3. Enable metrics projection and the turn report; observe four weeks before pruning adjusts anything.
4. Enable the per-conversation budget with ADR-0454 fan-out.

## Acceptance (installed)

- Every channel in the audit produces both records on a real turn; `measurement_unavailable` never fires in a week of fleet operation.
- A compact-mode Claude Code prompt shows up to three pointers within 150 ms and a later `referenced` record for a quoted document.
- Weekly metrics appear for terminal, conversation, supervision, and knowledge channels; the J1 result footer shows hits and tokens.
- An owner-reasoning run that exceeds its reservation stops in flight and records the stop.
- Tokens per successful outcome is reported for one standing goal over seven days.

## Deferred

Ground-truth relevance labelling, monetary cost, and cross-repository usage aggregation.

## References

- [Stage observation and performance](../../../../specifications/execution/stage-observation-and-performance.md)
- [Linked-evidence measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
- [ADR-0318 v20 qualification](../../../search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Paperclip comparison: capabilities and gaps](../../../../research/paperclip-lervo-comparison/capabilities-and-gaps.md)
