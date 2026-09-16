# Discord request intake

## Routing and intent

Discord goal intake uses ordinary authenticated `message.created` ingress. The managed turn resolver offers `supervision_goal_request` to a registered product owner or CEO. When supervision is installed, that durable agent ID must equal the installed owner ID. Discord routing uses installed intake only when the durable responding agent ID equals the installed owner ID.

The resolver selects `supervision_goal_request` for a durable multi-step outcome and keeps one bounded task or inspection on `repository_work`. The immutable intent record binds message hash, provider/model evidence, confidence, participation, effect, digest and time without copying raw text.

Conversation intent and effect-request authority checks precede intake; the responder rechecks human or explicitly admitted agent authority. A medium- or high-confidence installed-owner effect calls the shared intake writer. A missing route, unavailable effect, low confidence or unauthorized agent request does not.

The Node registers no `/goal` command and accepts no `outcomeSupervision.goalCommand` configuration. Historical `goal.requested` events remain schema-valid with their original provenance meaning, but new goal admission does not bypass model classification based on event kind.

## Human provenance

The result origin's `actor` is the outbound product-owner speaker, not the incoming requester. Native owner reasoning reads the exact durable interaction inbox row for a Discord-bound source event without mutating the inbox.

For ordinary `message.created` intake, reasoning also reads the immutable intent row and requires the same message hash, `continue_work`, `relevant`, medium or high confidence, and the exact no-argument `supervision_goal_request` effect. The inbound actor must be human; its content, target, policy, integration and conversation must match the stored result origin. A mention is not required. Historical `goal.requested` provenance retains its original owner-mention checks.

A missing inbox or natural-intent row supplies no human proof. A conflicting or invalid row fails closed. This supplies a bounded reasoning fact, not a new event or request-artifact field.

## Results and failures

The accepted result is published to the bound source origin through the existing independently reviewed result-delivery path. A successful installed-owner reply proves only canonical binding.

Typed refusals name the bounded reason and write nothing. Any unclassified failure follows the normal visible uncertain-response contract.

## Pending authority

A registered product owner or CEO without an installed supervision binding is also offered the effect, but its responder can only retain a `pending_authority` receipt.

The owner-only SQLite row records event, project, intended owner agent, content and source-key hashes, conversation/thread, requester identity coordinates, status and time. It contains no raw request and has an immutable 1,024-row bound. Exact replay is idempotent.

Conflict, capacity, unsafe storage or write failure produces no execution claim and follows the visible failure contract. Pending authority never counts as `work.supervision.bound`, goal creation, mandate installation, provider start or delivery.
