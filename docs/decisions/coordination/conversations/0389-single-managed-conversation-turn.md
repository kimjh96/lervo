# ADR-0389: Single managed conversation turn with repository retrieval

- Status: accepted
- Decision date: 2026-09-09

## Context

The initial natural-language Discord runtime classified intent and participation with a no-capability provider call, then generated an informational reply with a second managed provider call. Normal reads required two sequential model round trips. Typing started only after classification, leaving users without immediate acknowledgement during the slowest part of the path.

CLI managed runs prepared product-default lexical search, repository-knowledge hits, and relation recommendations. Discord managed reads injected required instructions and the current workstream without that retrieval preparation. Describing both as “managed Lervo execution” overstated infrastructure parity.

Discord is the first conversation surface, not the application boundary. Future Lervo clients must reuse turn semantics and evidence contracts without importing Discord transport or REST actions into core execution.

## Decision

### One surface-neutral managed turn

`@lervo/conversation-responder` owns a provider-neutral managed-turn application service. One read-only managed provider run returns a schema-constrained object containing:

- Semantic intent: `answer`, `continue_work`, or `clarify`.
- Confidence and this hired agent's `relevant` or `not_relevant` participation.
- Either no effect, repository work, or one caller-declared surface effect with a bounded argument.
- The human-facing reply for read-only answers and clarification.

The same immutable result drives participation, effect routing, and reply publication. Informational turns use no separate classifier. Repository changes still enter the signed Hub continuation and configured command provider; Discord actions still enter the allowlisted Discord administration adapter. The managed turn grants neither authority.

Surface adapters declare effect IDs and bounded argument descriptions. Core knows no Discord route, application ID, guild ID, channel ID, or REST operation. Node maps the current nickname effect to Discord. Future Lervo surfaces can declare their own effects and reuse the service unchanged.

`routing.response` selects the combined turn's provider, model, reasoning effort, and timeout. `routing.intent` remains accepted only for backward-compatible custom responder composition; the installed managed path neither invokes it nor attributes a turn to it. The default 60-second provider-turn deadline fails closed into the bounded conversation retry and terminal-failure path.

### Shared repository retrieval

`@lervo/repository-context` owns managed repository-context preparation previously held by the CLI. CLI execution and conversation turns share the implementation for:

- The qualified product-default lexical-v2 engine and exact projector identities.
- Operational search attempts and recommendation batches.
- Repository-knowledge query hits with source snapshot and impact coordinates.
- Relation-projection recommendations.
- Additional context candidates and linked-evidence shadow observation.

The managed context coordinator remains authoritative for `recommended`, `selected`, `loaded`, `injected`, and `referenced` evidence. Search and relation projections are rebuildable; recommendation does not make them canonical. Source hashes are checked again before context use.

The current repository measurement was about 2.2 to 2.5 seconds for cold local retrieval, recorded as preparation cost rather than provider latency. Retrieval remains exact and fail-closed. A future revision-keyed projection cache may optimize it only if invalidation and source-hash revalidation preserve those claims.

### Immediate activity and publication

For human-authored turns, response activity starts immediately after the durable inbox claim, before semantic relevance evaluation. The same idempotent activity lease passes to response generation and stops on silence, completion, retry scheduling, terminal failure, or unexpected error. Agent-authored turns do not make every peer bot display speculative typing before relevance is known.

The provider's structured envelope is internal. Only its verified reply field enters the existing chat writing contract and publication permit. Internal run, queue, revision, workstream, and artifact coordinates stay out of ordinary prose unless the user explicitly requests diagnostics.

## Evidence and privacy

The combined run retains the hired agent ID, exact role, selected provider and model, provider session, context evidence, stage timing, token usage, cache usage, result artifact, and root work causality. The intent store retains the bounded semantic result for routing history. Raw messages and replies remain CAS artifacts. Search attempts retain digests and source coordinates rather than copying request text.

Provider usage is reported only when the adapter proves it. Unavailable token or cache measurements remain unavailable; Lervo does not infer request-wide usage. Duration is enforceable during the turn. Token and cache ceilings can govern subsequent work only from complete observed accounting and must follow the existing fail-closed governed-budget policy when observation is required.

## Consequences

Normal Discord questions use one model round trip instead of two, typing appears before model work, and Discord reads consume the same managed repository retrieval as CLI execution. Codex and Claude remain interchangeable behind adapters. Change execution may use a different provider from the conversational turn, preserving the configured Codex-read and Claude-change split.

Real external latency acceptance requires human-authored Discord samples after deployment. Local or simulated measurements cannot establish Discord p95. A second visible hired agent still requires a separately provisioned Discord application and guild installation.

## References

- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Natural-language Discord conversation routing](../../../roadmap/product-outcome-convergence/host-products/discord/read-only-conversation.md)
