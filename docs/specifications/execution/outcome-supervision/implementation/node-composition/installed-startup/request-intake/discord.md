# Discord request intake

## Routing and intent

Discord goal intake uses ordinary authenticated `message.created` ingress. The managed turn resolver offers `supervision_goal_request` only to a deployment whose durable agent ID exactly equals the installed supervision owner ID. Configuration preflight rejects `policy.acceptsSupervisionGoals: true` without that matching authority.

The resolver selects `supervision_goal_request` for a durable multi-step outcome and keeps one bounded task or inspection on `repository_work`. The immutable intent record binds message hash, provider/model evidence, confidence, participation, effect, digest and time without copying raw text.

For `supervision_goal_request`, the same managed turn produces one concise acknowledgment grounded in the exact request and current conversation. It may state the understood outcome or priority but cannot claim admission, execution, completion or verification. Installed intake publishes this candidate only after a new canonical binding succeeds. Duplicate, refusal and historical-command outcomes supply bounded result codes and observed facts to the managed conversation writer; application-authored fixed conversational sentences are not published. A natural-language binding without its managed acknowledgment fails closed.

Conversation intent and effect-request authority checks precede intake; the responder rechecks human or explicitly admitted agent authority. A medium- or high-confidence installed-owner effect calls the shared intake writer. A missing route, unavailable effect, low confidence or unauthorized agent request does not.

The Node registers no `/goal` command and accepts no `outcomeSupervision.goalCommand` configuration. Historical `goal.requested` events remain schema-valid with their original provenance meaning, but new goal admission cannot bypass model classification based on event kind.

## Human provenance

The result origin's `actor` is the outbound product-owner speaker, not the incoming requester. Native owner reasoning reads the exact durable interaction inbox row for a Discord-bound source event without mutating the inbox.

For ordinary `message.created` intake, reasoning also reads the immutable intent row and requires the same message hash, `continue_work`, `relevant`, medium or high confidence, and the exact no-argument `supervision_goal_request` effect. The inbound actor must be human; its content, target, policy, integration and conversation must match the stored result origin. No mention is required. Historical `goal.requested` provenance retains its original owner-mention checks.

A missing inbox or natural-intent row supplies no human proof. A conflicting or invalid row fails closed. Requester provenance supplies a bounded reasoning fact, not a new event field.

New bindings also carry a private, source-bound prior-turn snapshot in the request artifact. Completed inbound turns with earlier platform timestamps and replies delivered before the request are eligible. Owner reasoning rechecks their immutable interaction rows and conversation CAS bytes. A previously delivered assistant answer can resolve “that” or a numbered reference but grants no fresh authority and does not prove a proposed effect happened. Legacy bindings without a snapshot are not retroactively filled from today's conversation state.

## Results and failures

The accepted result is published to the bound source origin through the existing independently reviewed result-delivery path. The immediate request-grounded acknowledgment proves only canonical binding; later progress and result messages require their own evidence.

Typed refusals name the bounded reason and write nothing. Any unclassified failure follows the normal visible uncertain-response contract.

## Missing authority

A deployment without matching supervision authority does not expose the goal effect. It may perform separately authorized bounded repository work through `repository_work`, but cannot retain a request as though later installation would make it executable.

Historical `pending_authority` rows from older runtimes remain immutable and inert. They never count as `work.supervision.bound`, goal creation, mandate installation, provider start or delivery.
