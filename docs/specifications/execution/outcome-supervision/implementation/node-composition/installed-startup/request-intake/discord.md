# Discord request intake

## Routing and intent

Discord goal intake uses ordinary authenticated `message.created` ingress. The managed turn resolver offers `supervision_goal_request` only to a deployment whose durable agent ID exactly equals the installed supervision owner ID. Configuration preflight rejects `policy.acceptsSupervisionGoals: true` when that matching authority is absent.

The resolver selects `supervision_goal_request` for a durable multi-step outcome and keeps one bounded task or inspection on `repository_work`. The immutable intent record binds message hash, provider/model evidence, confidence, participation, effect, digest and time without copying raw text.

For `supervision_goal_request`, the same managed turn produces one concise acknowledgment grounded in the exact request and current conversation. It may state the understood outcome or priority, but it cannot claim that admission, execution, completion or verification occurred. The installed intake publishes this candidate only after a new canonical binding succeeds. Duplicate, refusal, and historical-command outcomes provide bounded result codes and observed facts to the managed conversation writer; application-authored fixed conversational sentences are not published. A natural-language binding without its managed acknowledgment fails closed.

Conversation intent and effect-request authority checks precede intake; the responder rechecks human or explicitly admitted agent authority. A medium- or high-confidence installed-owner effect calls the shared intake writer. A missing route, unavailable effect, low confidence or unauthorized agent request does not.

The Node registers no `/goal` command and accepts no `outcomeSupervision.goalCommand` configuration. Historical `goal.requested` events remain schema-valid with their original provenance meaning, but new goal admission does not bypass model classification based on event kind.

## Human provenance

The result origin's `actor` is the outbound product-owner speaker, not the incoming requester. Native owner reasoning reads the exact durable interaction inbox row for a Discord-bound source event without mutating the inbox.

For ordinary `message.created` intake, reasoning also reads the immutable intent row and requires the same message hash, `continue_work`, `relevant`, medium or high confidence, and the exact no-argument `supervision_goal_request` effect. The inbound actor must be human; its content, target, policy, integration and conversation must match the stored result origin. A mention is not required. Historical `goal.requested` provenance retains its original owner-mention checks.

A missing inbox or natural-intent row supplies no human proof. A conflicting or invalid row fails closed. This supplies a bounded reasoning fact, not a new event or request-artifact field.

## Results and failures

The accepted result is published to the bound source origin through the existing independently reviewed result-delivery path. The immediate request-grounded acknowledgment proves only canonical binding; later progress and result messages require their own evidence.

Typed refusals name the bounded reason and write nothing. Any unclassified failure follows the normal visible uncertain-response contract.

## Missing authority

A deployment without matching supervision authority does not expose the goal effect. It may still
perform separately authorized bounded repository work through `repository_work`; it cannot retain a
request as though later installation would make that request executable. Historical
`pending_authority` rows created by older runtimes remain immutable and inert. They never count as
`work.supervision.bound`, goal creation, mandate installation, provider start, or delivery.
