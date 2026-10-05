# Deliberation surface behavior

## Origin-bound conversation

Discord uses one bound decision thread for the start acknowledgment, writing-gated artifact updates, and one terminal result. The main channel may receive coalesced start and terminal notices. Replies, restart recovery, and terminal delivery stay attached to the original Lervo origin.

Using the validated application query, the terminal coordinator targets exactly one conversation and thread, replies to the original source event, and mentions the requesting participant. A legacy `null` origin may fan out to configured conversations only as an operational notice; it has no reply coordinate and never fills `originDeliveryCoordinate`.

Every reply-bound outbound record carries its immediate source event and the immutable event it must answer. Synthetic deliberation signals retain their own event identity for replay; `replyToEventId` resolves the original native Discord message. Platform mapping must prefer the explicit reply coordinate and may fall back to the source event only for predecessor records. A signal-generated product reply delivered as a standalone Discord message does not satisfy origin-bound acceptance.

## Presentation and participation

Natural-language acknowledgments, real participant contributions, and terminal replies are product presentation, not queue or operator diagnostics. Unless a human explicitly requests diagnostics, they omit deliberation IDs, artifact and claim counts, writing-gate status, retry instructions, checkpoint terminology, and canonical-history repair guidance.

A start acknowledgment says review began and its result will return to the same conversation; it never reports zero artifacts as progress. A bound participant's writing-gated proposal, objection, revision, verification explanation, or decision appears as soon as its canonical event is available, without waiting for worker-process exit. Policy-only artifacts do not appear. A failed terminal reply gives a bounded canonical reason in ordinary language and states whether partial work was adopted or retried. Activity, trace, doctor, and exact diagnostic commands retain operational details.

Every acknowledgment, artifact update, failure notice, and terminal result is an observation-only publication for other agents:

- Outbound and normalized inbound contracts carry `audienceParticipation: observe_only`.
- Interaction records `publication_observation_only` without semantic relevance, typing, or provider execution.
- Discord preserves classification in versioned transport metadata, not visible text; history recovery restores it after restart.
- Missing or unsupported transport encoding fails before ambiguous publication.
- The field contains no content or platform identifier and grants no authority.

A human reply to the visible result is a distinct eligible event that may continue the conversation or explicitly address an agent.

The originating human message selects the response language. Korean requests use the versioned Korean conversation writing contract for proposals, reviews, verification explanations, revisions, final decisions, deterministic acknowledgments, failures, terminal presentation, and policy-owned participant labels when present. Repository documentation remains English by default. Surface language neither changes canonical evidence coordinates nor relaxes writing verification.

## Drafting and publication repair

Before drafting, every bound-participant prompt states that publication will appear verbatim in the originating conversation. It uses the participant's verified durable role profile, not a synthetic seat persona. It requires conclusion and user-visible impact first, followed by either the concrete next action the speaker owns or an explicit statement that no action is required. Unmet dependencies are approval conditions or missing evidence, never work delegated to another participant.

Proposal, revision, and decision turns are limited to 450 English words or Korean space-delimited words and eight paragraphs. Review and verification turns use smaller bounds. These generation bounds supplement the unchanged independent writing gate.

Publication repair receives exact failed semantic check IDs and permits at most one fresh, language-matched retry. A `direct_result_and_action` repair states the review result and user impact; it never assigns the next action to another person, named role, owner, reviewer, verifier, user, or team. Dependencies are objective approval conditions or missing evidence.

Plain-language repair treats topic and shared-artifact wording as evidence, not reusable prose. It removes avoidable internal names and every path, file or command name, abbreviation, state label, hash, and machine identifier. Product, protocol, stage, and version labels become observable behavior unless the name is material and explained inline. The replacement is limited to eight paragraphs and 450 English words or Korean space-delimited words; it does not restate the complete design. Managed events and context receipts retain exact evidence.

A failed or invalid semantic-evaluator invocation is infrastructure evidence, not a writer-repairable defect: publication terminates without spending the bounded rewrite. Repeating an undirected rewrite after the same failed check is invalid recovery.

Publishable prose includes exact repository paths only when location is necessary to understand the conclusion. If the separate writing evaluator rejects audience language, the single allowed fresh-turn repair forbids paths, file and command names, backticked names, abbreviations, repository state labels, hashes, and machine identifiers. It restates checked behavior and significance in plain language. Canonical execution events, loaded-context receipts, and artifact evidence retain exact provenance. The repair receives neither evaluator prose nor the quarantined draft, cannot weaken the writing gate, and creates no deliberation artifact unless the complete gate passes.

## Topic and context resolution

Deictic requests such as "review this design" bind the exact current human message and bounded prior human anchors into the topic. Recent agent and system chatter remains available to ordinary conversation but cannot evict the most recent human design context from deliberation scope. The queue stores only the bounded topic and existing digest; native platform identifiers and credentials remain excluded.

Natural-language effect resolution may encounter transient repository snapshot failure while replica bytes change. Because this precedes provider start, the interaction retries only within the configured response-attempt bound and takes a fresh exact snapshot. Exhaustion fails closed with the normal language-matched context-unavailable reply, creates no deliberation job, and never treats a partial snapshot as evidence.

## Terminal content

- `converged`: publish the writing-gated final decision body recovered from its canonical decision-artifact coordinate.
- `no_consensus`: state that no disputed conclusion was accepted and include the last writing-gated review.
- `failed` or inconclusive reconciliation: state plainly that no partial result was accepted.

Before publication, the coordinator verifies project, deliberation, terminal status, artifact coordinate, content hash, and bounded bytes. Missing or contradictory final artifacts leave notification retryable; status plus artifact count is never a fallback.

## Artifact projection and cursor

Each new `deliberation.artifact.recorded` repository event passes through the structured-artifact validator used by the host-neutral product projection. The Discord projector requires exactly one active real-participant binding for a bound artifact, verifies its writing-gated Markdown byte count and content hash, and asks that participant runtime to publish through its existing deployment. It adds no policy-role heading, round number, role ID, claim count, or gate status.

An unbound artifact advances the internal cursor without creating a Discord event. Canonical coordinates remain available for activity, trace, search, and future first-party views. Prompts, private reasoning, unverified provider payloads, credentials, and native Discord identifiers remain excluded.

Canonical contributions remain complete when a channel has a smaller presentation limit. Discord deterministically presents an observation-only excerpt within its 2,000-character bound and states that the complete contribution remains available through Lervo records and unified search. Human-directed replies are never silently shortened. Delivery receipts prove the bounded Discord projection; the original artifact hash and conversation outbound retain the complete writing-gated content.

The rebuildable `deliberation-artifact-cursor.json` stores schema version, exact cursor kind, project ID, integration ID, last inspected repository-event sequence, and update time. Missing state checkpoints the current head to prevent surprise historical replay.

For a bound origin, advancement follows exactly one durable interaction outbound. A crash before advancement is deduplicated by deterministic source-event identity. Platform delivery remains the responsibility of the interaction outbox and adapter receipt. Legacy events without origin are skipped and cannot satisfy product acceptance. Invalid structured evidence, unavailable interaction ownership, or zero or multiple responding policies fails the worker before advancement. Startup validates the required proactive signal subscription.

## Durable notification and delivery

Settlement and reconciliation atomically create a durable notification obligation:

| State      | Meaning                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `pending`  | Host-ready                                                                                              |
| `leased`   | Held by one bounded worker                                                                              |
| `accepted` | The normalized event and exactly one writing-gated outbound were committed to the interaction lifecycle |

Project ID, deliberation ID, terminal summary, and settlement time are required and immutable. A lease adds worker, attempt, and expiry fields; acceptance adds a Lervo conversation-event ID and time. The obligation stores no topic, message body, principal, native Discord identifier, credential, provider payload, or delivery receipt.

An expired lease is reclaimed with its original settlement time to preserve stable event identity. Missing origin uses only the explicit legacy fallback. Missing fallback, missing interaction runtime, zero responding participation policies, or multiple responding policies leaves the obligation unaccepted and exposes a retryable configuration failure. Adapter rejection and uncertain send retain existing interaction and platform replay meanings.

`accepted` does not claim delivery. `originDeliveryCoordinate` stays `null` until the accepted event joins an outbound with valid writing evidence and a durably stored adapter receipt. Existing inbox, outbox, and platform replay contracts recover a crash after interaction acceptance without regenerating the deliberation or terminal obligation.

## Uncertain execution recovery

The application enumerates bounded uncertain start and resume jobs with immutable uncertainty times for restart recovery. The coordinator invokes only the authoritative reconciliation source, never original provider execution. A confirmed result settles the owning queue and atomically creates its notification.

After bounded inconclusive inspections, owner attention uses uncertainty time in a stable event identity and checks the append-only interaction inbox for the same logical source key before publication. This suppresses duplicates across runtime restarts and the earlier timestamp-derived event identity. Incomplete or inconsistent history remains uncertain and produces no terminal claim.

## Process integration and other surfaces

The installed process adapter prepends the running Node executable's directory to child `PATH` before invoking the configured Lervo CLI. This preserves the explicit runtime dependency of `/usr/bin/env node` script entrypoints, including systemd services whose inherited `PATH` omits the private runtime installation. Child stdout and stderr remain bounded; user-facing replies never include child stderr. Operator diagnostics retain typed launch, exit, output, source, or artifact failure meaning instead of relabeling all process failures as repository-history explanations.

The future first-party decision room renders the same proposals, objections, revisions, verification, adopted claims, unresolved objections, terminal status, resources, and source links. Neither surface exposes private reasoning or provider conversations.

Exact commands remain available for policy selection, status, resume, and diagnostics. Natural start requires an explicit human request and a configured default policy. Product recommendations are read-only and cannot invoke `deliberation.start`.
