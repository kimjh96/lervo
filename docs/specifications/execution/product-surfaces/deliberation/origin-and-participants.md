# Origin and participant binding

## Start binding

Before queue execution, the application binds:

- Project, conversation, thread, and source conversation-event coordinates.
- Requester participant and authorized principal.
- Policy ID, policy hash, and requested topic digest.
- Deliberation ID and start idempotency coordinate.
- The exact participant, hired agent, role revision, provider policy, and surface identity resolved for each policy role, or an explicit policy-only role disposition.

Origin is a rebuildable join between the queue's durable source event and the immutable conversation-event target. Every new start job stores a `ConversationDeliberationOriginBinding` with required conversation ID, nullable thread ID, requester-participant ID, and binding digest. The digest also binds project and source event. Legacy all-null origin columns remain readable but cannot satisfy the product projection; partial or malformed bindings are queue-integrity failures. Coordinates are opaque Lervo coordinates: principal identity remains hashed, and the queue excludes native platform IDs, credentials, and request content.

`ConversationApplication.inspectDeliberationOrigin` is the read-only application boundary for this join. Given project and deliberation IDs, it returns the queue-validated source event and origin binding, or `null` for an unconfigured, missing, or legacy deliberation. It never infers coordinates from notification configuration. Decode or digest failures propagate as integrity failures, never `null`.

Participant identity uses existing organization deliberation-participant bindings; no second origin, chat, or identity store is added. Projections contain Lervo coordinates, never native Discord channel or message IDs. Transport adapters recover current platform delivery coordinates through existing mappings. Missing or contradictory origin or participant evidence fails before provider execution.

## Accepted participant routes

An accepted named route is a `DeliberationParticipantAssignment`, requiring:

- Deliberation and policy IDs; policy-role seat; project and conversation IDs.
- Organization, team, membership, deployment, and channel-membership IDs.
- Durable agent and participant IDs.
- Workforce role revision and hashes; provider-policy hash.
- Provider; nullable model and reasoning effort.
- Execution-route hash, assignment ID, and acceptance time.

`organization.deliberation.participant.bound` version 2 persists assignment ID, distinct policy and workforce roles, route hash, provider, and acceptance time alongside predecessor coordinates. Partial version-2 payloads are invalid. Resume with an omitted, unavailable, or changed accepted route fails before another provider call. These records exclude native Discord IDs, credentials, topic, prompt, result prose, and private reasoning.

The assigned worker forwards the immutable Lervo origin binding to the managed deliberation process. Participant projection consumes canonical `organization.deliberation.participant.bound` evidence; it never synthesizes bindings from conversation presence, provider compatibility, or matching job labels. An unknown workforce-provider hash invalidates the product projection and cannot be reinterpreted as the policy-selected provider.

A named external speaker requires proof that its runtime accepted the participation assignment, executed the turn under that durable agent binding, and delivered through the already reviewed bot or webhook deployment. Without all proofs, the artifact stays internal and creates no visible speaker.

## Roles, authorship, and coverage

The policy role owns deliberation semantics; the bound agent owns provider-route authorship. Work causality records the agent ID only for provider turns in that seat. Seat-specific model or reasoning effort does not affect semantic evaluators or other policy roles. Existing routine, reasoning, and review allocation policy remains authoritative for ordinary repository work.

A product policy defines decision responsibilities and required coverage, not Discord identities. The decision owner represents the product outcome. Independent evidence covers affected installed-user, core and knowledge, compatibility, operations, security, and observability concerns; verification remains separate.

Policy-only responsibilities stay internal and are never presented as hired agents or separate personalities. Installed visible-participant acceptance for a recurring policy requires reviewed bindings to the intended hired agents. A convenient provider assignment or a role named only `proposer` or `reviewer` is not a participant binding.
