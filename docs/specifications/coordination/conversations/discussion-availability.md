# Discussion availability and response composition

`apps/node-runtime/src/conversation-discussion-availability.ts` filters configured conversation IDs by calling `selectConversationDiscussionParticipants` with each conversation, the supplied peers, and the fixed source-event coordinate `surface-availability`. It includes a conversation only when the selector returns exactly two participants. The selector owns validation and independence semantics; the helper does not independently inspect remote runtime health.

For ineligible conversations, two catalog helpers remove only `deliberation_start`: one filters managed surface-effect objects by effect ID; the other filters legacy intent-effect kinds. Eligible calls return array copies. Catalog filtering neither grants effect authority nor proves that a discussion started.

## Composition

`apps/node-runtime/src/discord-conversation-response-composition.ts` computes the eligible list from configured conversation bindings and peer agents and supplies it to `NaturalLanguageDiscordConversationResponder`. It still constructs the discussion runtime and action responder; ineligibility does not disable all discussion infrastructure or remove unrelated effects.

Composition supplies configured repository-work defaults and semantic execution-profile routes to the managed turn resolver. These are requested routing coordinates, not observed provider identity or successful execution. When the native repository-work runtime exists, its recovery is invoked before response composition completes.

A custom read-only responder requires a custom intent resolver or legacy `routing.intent` configuration; otherwise composition rejects it. The ordinary managed path uses the managed turn resolver. An explicitly supplied custom intent resolver selects the alternative path.

## Resolution and dispatch

`apps/node-runtime/src/discord-conversation-mode.ts` resolves discussion directives before ordinary mode selection. A recognized directive receives a synthetic discussion resolution. A discussion coordination event without an accepted directive is recorded as not relevant and bypasses ordinary intent resolution. Goal events and recognized explicit control commands also precede ordinary managed or legacy resolution.

For ordinary turns, availability depends on membership in the optional eligible-conversation list. An absent list defaults availability to true; an empty list makes every conversation ineligible. The responder passes the filtered surface catalog to managed resolution and the filtered effect-kind catalog to fresh legacy intent resolution.

Legacy stored resolutions are reused without a new intent call. This branch does not re-filter the stored selected effect against the current catalog. Catalog filtering is therefore not an authorization or replay-validation boundary. Mode admission and effect responders retain separate authority checks.

Resolution promises and discussion-directive promises are memoized separately by event ID, each with a 1,024-entry limit and oldest-key eviction. These maps do not establish durable deduplication or retry guarantees.

Response dispatch first offers the discussion directive to its response helper. Otherwise it dispatches explicit control, platform action, an existing managed read or clarification candidate, repository work, goal, continuation, or the read-only responder as applicable. Platform actions receive the separately computed effect-requester authorization result. Work falls back to the continuation responder when no work responder is supplied.

## Publication and evidence limits

Composition selects the fixed writing contract for deliberation publication signals and discussion next-assignment or failure directives. Other output uses the mode-dependent publication contract, including independent read-evaluation configuration and managed platform-action result handling. Terminal failures have their own fixed responder and verifier.

The returned close method awaits requested-runtime closure, then invokes closure on the read runtime, repository-work responder, intent store, and discussion runtime. This method alone does not establish disposal of every constructed resource or application-wide shutdown drain.

These sources implement catalog and response wiring under [ADR-0421](../../../decisions/coordination/conversations/agent-organization/0421-separate-real-agent-discussion-from-policy-coverage.md). They do not prove authenticated remote acceptance, two completed reviews, installed service readiness, final synthesis, or Discord delivery. Historical review gaps do not establish earlier source meaning or settle those acceptance obligations.
