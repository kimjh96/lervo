# ADR-0389: Single managed conversation turn with repository retrieval

- Status: accepted (amended 2026-09-18)
- Decision date: 2026-09-09

## Context

The initial natural-language Discord runtime classified intent and participation with a no-capability provider call, then generated informational replies with a second managed call. Normal reads required two sequential model round trips, and typing began only after classification.

CLI managed runs prepared product-default lexical search, repository-knowledge hits, and relation recommendations. Discord reads injected required instructions and the current workstream without retrieval preparation, so calling both “managed Lervo execution” overstated infrastructure parity.

Discord is the first conversation surface, not the application boundary. Future clients must reuse turn semantics and evidence contracts without bringing Discord transport or REST actions into core execution.

## Decision

### One surface-neutral managed turn

`@lervo/conversation-responder` owns a provider-neutral managed-turn application service. One read-only managed provider run returns a schema-constrained object containing:

- Semantic intent: `answer`, `continue_work`, or `clarify`.
- Confidence and the hired agent's `relevant` or `not_relevant` participation.
- No effect, repository work, or one caller-declared surface effect with a bounded argument.
- A human-facing reply for read-only answers and clarification.

The same immutable result drives participation, effect routing, and reply publication. Informational turns have no separate classifier. Repository changes enter the signed Hub continuation and configured command provider; Discord actions enter the allowlisted Discord administration adapter. The managed turn grants neither authority.

Surface adapters declare effect IDs and bounded argument descriptions. Effects selecting from a bounded runtime population declare exact machine values and human-facing labels in a separate argument-choice catalog, not topology-sized prose descriptions. The managed contract accepts at most 64 unique bounded choices and includes them in the request digest and provider instructions. The executing adapter still validates the selected value against current authority.

Core knows no Discord route, application ID, guild ID, channel ID, or REST operation. Node maps the current nickname effect to Discord. Future surfaces can declare effects and reuse the service unchanged.

`routing.response` selects the combined turn's provider, model, reasoning effort, and timeout. `routing.intent` remains accepted only for backward-compatible custom responder composition; the installed managed path neither invokes it nor attributes turns to it. The default 60-second provider-turn deadline fails closed into the bounded conversation retry and terminal-failure path.

The turn request separately carries the configured repository-work default and semantic execution-profile routes. When asked which model will perform future work, the responder uses those routes rather than its own `routing.response` identity, names the relevant task profile or conditional allocation, and treats requested model names as configuration rather than provider-observed identity. Session continuity and an explicitly bound agent may still precede profile preference.

### Shared repository retrieval

`@lervo/repository-context` owns managed repository-context preparation previously held by the CLI. CLI execution and conversation turns share implementations for:

- The qualified product-default lexical-v2 engine and exact projector identities.
- Operational search attempts and recommendation batches.
- Repository-knowledge query hits with source snapshot and impact coordinates.
- Relation-projection recommendations.
- Additional context candidates and linked-evidence shadow observation.

The managed context coordinator remains authoritative for `recommended`, `selected`, `loaded`, `injected`, and `referenced` evidence. Search and relation projections are rebuildable; recommendation does not make them canonical. Source hashes are rechecked before context use.

Before opening conversation ingress, Node prepares one query-neutral repository-knowledge index. Every hired agent deployed for the same repository shares that projection and one repository-snapshot capture lifecycle. Agent identity, role context, provider sessions, history, and publication remain isolated. A second bot does not duplicate canonical repository scanning or its in-memory projection.

The projection is keyed by the exact managed repository snapshot revision and replaced when that revision changes. A prepared knowledge `sourceSnapshotId` identifies the bounded observation that created it, not inclusion of later supplemental events. Supplemental event additions do not mutate canonical sources or sidecars. A canonical source, claim, concept, or relation change invalidates the repository revision. Selected publication bytes are reread and content-hash checked immediately before context use. Memory is bounded to one current and one in-flight revision.

Managed conversation snapshots walk the complete policy-included tree before and after every provider turn. A conversation-lifetime capture may reuse a regular-file or symlink hash only while path kind, device, inode, size, modification time, and change time all remain exact. Any metadata change forces a safe reread; additions and deletions remain visible. The post-run snapshot contributes to `repository_snapshot`, not `provider_stop`, separating stage evidence for enforcement and adapter shutdown.

The common snapshot policy excludes generated dependency environments such as Python `.venv` and `venv` directories anywhere in the repository. A dependency installation must not consume the one-gigabyte source snapshot budget or prevent an otherwise valid read-only conversation turn. Repository-authored files outside those conventional generated directories remain subject to existing byte and entry limits.

A repository snapshot failure before provider start is safe for the interaction lifecycle to retry within its existing bounded response-attempt limit. This covers transient races with replica application or another repository writer without replaying provider work. Retry takes a fresh exact snapshot, without reusing partial bytes or weakening fail-closed comparison. Exhaustion publishes the bounded context-unavailable result. Knowledge preparation, context injection, and post-start provider failures remain terminal under their existing classifications.

Pre-cache cold local retrieval measured about 2.2–2.5 seconds. A current local measurement observed 2,495 ms for initial knowledge preparation and 1.3 ms for a revision-matched query; a cold snapshot took 879 ms, followed by 72 ms metadata-validated snapshots. These development-host observations do not establish Discord latency acceptance. Retrieval remains exact and fail-closed.

### Immediate activity and publication

For human-authored turns selected for response by participation, activity starts immediately after the bounded participation-window lookup and decision, before managed response work. Dedicated natural-language routing decides without semantic relevance evaluation, so normal human messages show activity before model work. Selective shared-channel evaluation, rate limiting, cooldown, and non-owner decisions do not display speculative typing.

The same idempotent activity lease passes to response generation and scheduled retry. It stops on completion, terminal failure, abort, or safety timeout. Agent-authored turns do not make every peer bot display speculative typing before relevance is known.

The provider's structured envelope is internal. Only its verified reply field enters the existing chat writing contract and publication permit. Internal run, queue, revision, workstream, and artifact coordinates stay out of ordinary prose unless the user explicitly requests diagnostics.

Injected documents, workstream notes, and prior turns remain evidence with their own observation times, not automatic proof of current external state. Managed instructions prohibit deriving one common cause from generic historical failure codes, equating `attention_required` with definite platform absence, or substituting request/start time for completion/failure/publication time. Native repository-work instructions also treat provider tool and connector availability as turn-local: tool visibility does not prove account authorization, and one provider's missing tool does not prove global uninstallation.

## Evidence and privacy

The combined run retains the hired agent ID, exact role, selected provider and model, provider session, context evidence, stage timing, token usage, cache usage, result artifact, and root work causality. The intent store retains the bounded semantic result for routing history. Raw messages and replies remain CAS artifacts. Search attempts retain digests and source coordinates rather than request text.

Provider usage is reported only when the adapter proves it. Unavailable token or cache measurements remain unavailable; Lervo does not infer request-wide usage. Duration is enforceable during the turn. Token and cache ceilings can govern subsequent work only from complete observed accounting and must follow the existing fail-closed governed-budget policy when observation is required.

## Consequences

Normal Discord questions use one model round trip instead of two, typing appears before model work, and Discord reads use the same managed repository retrieval as CLI execution. Repeated turns avoid rebuilding unchanged projections or rehashing unchanged bytes. Multiple named agents share repository infrastructure while keeping identities and memories isolated.

Codex and Claude remain interchangeable behind adapters. Change execution may use a different provider from the conversational turn, preserving the configured Codex-read and Claude-change split.

Real external latency acceptance requires human-authored Discord samples after deployment. Local or simulated measurements cannot establish Discord p95. A second visible hired agent requires a separately provisioned Discord application and guild installation.

## References

- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Natural-language Discord conversation routing](../../../roadmap/product-outcome-convergence/host-products/discord/read-only-conversation.md)
