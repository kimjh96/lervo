# Presentation, participation, and publication repair

## Product presentation

Natural-language acknowledgments, real participant contributions, and terminal replies are product presentation, not queue or operator diagnostics. Unless a human explicitly requests diagnostics, omit deliberation IDs, artifact and claim counts, writing-gate status, retry instructions, checkpoint terminology, and canonical-history repair guidance.

A start acknowledgment says review began and its result will return to the same conversation; it never reports zero artifacts as progress. A bound participant's writing-gated proposal, objection, revision, verification explanation, or decision appears as soon as its canonical event is available, without waiting for worker-process exit. Policy-only artifacts do not appear. A failed terminal reply gives a bounded canonical reason in ordinary language and states whether partial work was adopted or retried. Activity, trace, doctor, and exact diagnostic commands retain operational details.

## Observation-only participation

Every acknowledgment, artifact update, failure notice, and terminal result is an observation-only publication for other agents:

- Outbound and normalized inbound contracts carry `audienceParticipation: observe_only`.
- Interaction records `publication_observation_only` without semantic relevance, typing, or provider execution.
- Discord preserves classification in versioned transport metadata, not visible text; history recovery restores it after restart.
- Missing or unsupported transport encoding fails before ambiguous publication.
- The field contains no content or platform identifier and grants no authority.

A human reply to the visible result is a distinct eligible event that may continue the conversation or explicitly address an agent.

## Response language

The originating human message selects the response language. Korean requests use the versioned Korean conversation writing contract for proposals, reviews, verification explanations, revisions, final decisions, deterministic acknowledgments, failures, terminal presentation, and policy-owned participant labels when present. Repository documentation remains English by default. Surface language neither changes canonical evidence coordinates nor relaxes writing verification.

## Drafting

Before drafting, every bound-participant prompt states that publication will appear verbatim in the originating conversation. It uses the participant's verified durable role profile, not a synthetic seat persona. It requires conclusion and user-visible impact first, followed by either the concrete next action the speaker owns or an explicit statement that no action is required. Unmet dependencies are approval conditions or missing evidence, never work delegated to another participant.

Proposal, revision, and decision turns are limited to 450 English words or Korean space-delimited words and eight paragraphs. Review and verification turns use smaller bounds. These generation bounds supplement the unchanged independent writing gate.

## Publication repair

Publication repair receives exact failed semantic check IDs and permits at most one fresh, language-matched retry. A `direct_result_and_action` repair states the review result and user impact; it never assigns the next action to another person, named role, owner, reviewer, verifier, user, or team. Dependencies are objective approval conditions or missing evidence.

Plain-language repair treats topic and shared-artifact wording as evidence, not reusable prose. It removes avoidable internal names and every path, file or command name, abbreviation, state label, hash, and machine identifier. Product, protocol, stage, and version labels become observable behavior unless the name is material and explained inline. The replacement is limited to eight paragraphs and 450 English words or Korean space-delimited words; it does not restate the complete design. Managed events and context receipts retain exact evidence.

A failed or invalid semantic-evaluator invocation is infrastructure evidence, not a writer-repairable defect: publication terminates without spending the bounded rewrite. Repeating an undirected rewrite after the same failed check is invalid recovery.

Publishable prose includes exact repository paths only when location is necessary to understand the conclusion. If the separate writing evaluator rejects audience language, the single allowed fresh-turn repair forbids paths, file and command names, backticked names, abbreviations, repository state labels, hashes, and machine identifiers. It restates checked behavior and significance in plain language. Canonical execution events, loaded-context receipts, and artifact evidence retain exact provenance. The repair receives neither evaluator prose nor the quarantined draft, cannot weaken the writing gate, and creates no deliberation artifact unless the complete gate passes.
