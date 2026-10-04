# ADR-0418: Retain deliberation as a bounded decision workflow

- Status: accepted
- Decision date: 2026-09-16

## Context

Lervo's provider-neutral deliberation core has fixed proposer, reviewer, verifier, and decision-owner roles; structured proposal, objection, revision, verification, and decision artifacts; independent provider sessions; explicit convergence and `no_consensus`; and durable queueing, leases, restart recovery, reconciliation, and source-bound evidence. Discord can start it through an exact command or an explicit natural-language request when a default policy is configured.

Ordinary multi-agent chat cannot replace these capabilities: free-form agreement does not prove which sources participants read, whether blocking objections were resolved, or whether verification passed.

Installed integration remains incomplete. Deliberation can appear to overlap with ordinary multi-agent conversation despite requiring several managed provider and writing-evaluation turns. Terminal notifications fan out to configured conversations without proving delivery to the originating thread, and show status and artifact counts rather than usable decision history. Policy roles lack explicit relationships to visible hired-agent identities, and deliberation has no dedicated budget or observability view.

## Decision

Retain the deliberation domains, runtime, artifacts, queue, and evidence semantics. Present formal deliberation as an optional, high-assurance decision workflow above ordinary conversation and work execution, not the default engine for multi-agent participation, routine review, repository verification, or every goal.

### Authority and origin

Use deliberation when a human explicitly requests independent challenge, competing designs, consensus, or a policy-bound decision. A surface may recommend it for high risk, materially conflicting alternatives, or unresolved blocking objections; recommendation grants no start authority. Initially, start, read, and resume authority belong to an explicitly bound human principal. Autonomous start requires a later reviewed principal, authority, and budget decision. Ordinary agents cannot gain authority from a mention, role relevance, or model classification.

Before execution, bind the Lervo conversation, thread, source event, requester, policy ID and hash, and resulting deliberation ID. The origin projection joins the queue's durable source event to the immutable conversation-event target without another chat or origin store. Discord renders a bounded decision thread. The source conversation receives one start acknowledgment and one terminal result. Writing-gated projections place proposal, objection, revision, verification, and decision artifacts in the bound thread. Conversation-wide fan-out may remain an operational fallback but does not complete the product contract.

Expose the validated queue binding through a read-only, host-neutral origin query. Terminal coordination uses its Lervo conversation, nullable thread, source event, and requester coordinates to create one deterministic reply signal. Legacy records without origins may use conversation-wide notification, recording origin delivery as unavailable. A malformed binding is a queue-integrity failure. The query and result contain no native platform identifier, content, credential, or provider payload.

### Terminal notification and recovery

Create a terminal-notification obligation in the same SQLite transaction as queue settlement or authoritative reconciliation. Its states are:

- `pending`: project, deliberation, terminal summary, and immutable settlement time.
- `leased`: adds only bounded worker, attempt, and expiry coordinates.
- `accepted`: adds the normalized Lervo conversation-event ID and acceptance time, only after the interaction store durably owns the event and exactly one writing-gated outbound.

Zero or multiple responding policies leave the obligation unaccepted and expose a retryable configuration failure. After lease expiry, retry with the same settlement time and event identity. `accepted` does not prove platform delivery: only the interaction outbox and adapter delivery receipt can provide `originDeliveryCoordinate`. Missing routing or interaction ownership leaves the obligation retryable and fails the runtime cycle without rerunning deliberation.

Every reconciliation cycle enumerates uncertain start and resume jobs from their durable queue with their immutable uncertainty time. Process-local attempt tracking bounds inspection within one runtime; durable time gives exhausted owner attention a stable conversation-event identity across restarts. Before publishing attention, check the append-only interaction inbox for the same logical source key, including records with the earlier timestamp-derived identity. Restarted inspection must neither replay provider execution nor produce another Discord message for the same unresolved job. Inspection recovery does not prove a terminal outcome: only confirmed canonical history may settle the queue and create a terminal notification.

Inconclusive authoritative inspection remains retryable until canonical history proves a terminal state or the interaction store durably owns the bounded attention publication. Record process-local exhaustion only after that ownership succeeds. A transient interaction or delivery failure must not silently discard the sole user-visible failure obligation.

### Participants and stakeholders

At start, resolve each policy role through organization deliberation-participant events to its exact durable participant, hired agent, and role revision when available. Honestly label policy-only execution roles; never invent hired-agent identities. Keep provider, model, run, session, context evidence, artifact, and verification coordinates independently observable.

Policies select decision stakeholders, not generic execution labels. The decision owner represents the requested outcome. Reviewers represent materially affected user, channel, core and knowledge, compatibility, operations, security, and observability concerns. Verification remains independent. One reviewer may cover several explicitly named concerns for a bounded decision. Provider names or the labels `proposer`, `reviewer`, and `verifier` alone are not stakeholder identities.

### Replies, language, and publication

Natural-language replies are a separate presentation boundary from exact commands and operator diagnostics. Start replies omit queue IDs, artifact counts, checkpoint instructions, and zero-artifact receipts. Terminal `converged` and `no_consensus` replies recover and verify writing-gated final artifact bytes and return the substantive decision or last review to the originating conversation. Failure replies state only the user consequence and that no partial result was accepted. Detailed process and reconciliation evidence stays in activity, trace, doctor, and exact diagnostic routes.

The originating human message selects English or Korean. Managed deliberation uses the matching versioned conversation writing contract for proposals, independent reviews, verification explanations, revisions, and decisions. A stored workflow may own localized participant presentation names. The execution plan selects the request language before recording artifact events, so Discord never independently translates canonical role IDs or English labels. Deterministic status text uses the same language; repository documentation defaults to English.

A failed semantic publication attempt passes its exact failed check IDs into one bounded repair attempt. Plain-language repair treats topic and shared-artifact wording as evidence, not text to copy; removes avoidable internal names; and explains every retained repository-relative path in reader-facing terms in the same sentence. Evaluator invocation failure or an invalid returned contract is not a prose defect and does not spend another writer turn. Synthetic signals retain their immediate source and original reply event so Discord answers the human request instead of publishing an unrelated standalone message. Bounded history retains recent human anchors separately from general recent turns, preventing agent chatter from erasing the design referenced by "this" or equivalent wording.

A read-only semantic evaluator may retry its existing artifact once when a managed child run fails at a retry-safe infrastructure boundary: repository snapshot, provider start, stream, turn, model availability, or result collection. Use a fresh provider session and record existing `publication_evaluation` causality with attempt ordinal two. Do not retry contract-invalid output, capability or telemetry failures, or a completed negative writing judgment. Never rerun the writer for evaluator infrastructure recovery. Exhaustion fails closed without publishing the artifact.

### Repository snapshots

The managed runner owns one cached repository-snapshot capture for the entire bounded workflow, including semantic-evaluator child runs. Every capture still walks the current repository, validates file identity before and after changed-file reads, and produces the same content-derived revision. Unchanged files reuse identity-bound hashes across child runs, avoiding independent full-repository reads under each proposal, evaluation, review, verification, or decision session's snapshot deadline.

### Schemas, history, and budgets

Version-1 schemas and queue records retain their meanings. New conversation-started records add an immutable Lervo origin binding; legacy records remain readable without one. Queue upgrades backfill one pending notification obligation for an already settled record without changing its summary or settlement time.

New artifact events may contain the complete validated structured artifact alongside original summary coordinates. Old events remain readable without it; duplicate coordinates must agree. Embedded artifacts exclude Markdown bodies, prompts, reasoning, provider responses, credentials, and native platform identifiers. This reader-first addition makes proposal, objection, revision, verification, and decision relationships rebuildable without an approved resume checkpoint.

New start events may contain the complete validated provider-neutral policy alongside the original policy ID, hash, participant roles, and round bound. Duplicate coordinates must agree. Policies contain no topic, prompt, reasoning, provider response, credential, or native platform identifier. A hash-only predecessor remains valid and is projectable only while a current source reproduces its exact recorded hash. Policy drift is unavailable, not historical reinterpretation.

Policy hashes bind provider calls, tokens, elapsed time, and missing observations; checkpoints preserve consumption. Before any call, topic-ranked current sources form one exact-hash stakeholder bundle. Missing or changed evidence starts no provider. Time reserves finalization; a recorded failure returns as terminal `failed`.

### Installed composition and delivery

Product-host protocol v11 installs the read-only composition. It opens current queue and interaction schemas without migration, freezes repository events and revision, validates policy, history, verification, organization, and resource relations, and distinguishes writing-gated outbound from receipt-backed delivery. Reject multiple terminal outbounds, contradictory coordinates, count mismatches, or source changes during inspection. The protocol grants no workflow or delivery authority.

The installed Node composition projects each structured artifact into its bound thread while the long-running deliberation worker remains active. It verifies and republishes the writing-gated body under the language-selected, policy-bound participant name, giving the thread timely labeled stakeholder contributions rather than a delayed event dump or round and count summaries. Structured coordinates remain canonical activity and search data. Never copy prompts, private reasoning, unverified provider material, credentials, or platform identifiers. A fixed-contract responder adds no provider turn. A rebuildable cursor advances after one durable outbound; deterministic identity and existing replay cover crashes. Missing origins remain unprojected. Missing or mismatched content and ambiguous ownership fail closed.

Discord marks and bounds oversized observations to 2,000 characters while retaining the complete canonical artifact and outbound for search. Receipts prove that projection; never shorten human replies. Apply the same rule when recovering older queued contributions.

## Product and knowledge boundaries

`converged` means the deliberation contract accepted a decision with required verification and no blocking objection. It does not approve repository work, authorize external effects, or promote canonical knowledge. A converged decision may create a source-bound knowledge or work candidate through the existing review lifecycle. `no_consensus` selects no winner and promotes nothing.

Unified search may return authorized deliberation artifacts and outcomes as a distinct corpus. Activity and observability may show coordinates, statuses, provider usage, cached-input tokens, stage durations, publication attempts, and delivery evidence. They never expose hidden reasoning, prompts, raw provider payloads, credentials, or unrestricted artifact bodies.

## Removal and deprecation boundary

Retain the deliberation core and exact command route. The command remains available for diagnostics, exact policy selection, status, and recovery.

Remove these behaviors from product completion:

- Automatically starting formal deliberation for ordinary multi-agent conversation.
- Treating conversation-wide notification as origin-bound delivery.
- Treating terminal status or artifact count alone as a usable decision result.
- Treating provider agreement, majority, or a converged artifact as canonical truth or effect authority.

## Acceptance

Installed Discord acceptance includes positive and negative journeys.

The positive journey starts from an explicit human request, survives restart, shows named or honestly role-labeled stakeholders and structured artifacts in one bound thread, records separate per-role resource evidence, and delivers exactly one verified terminal decision body or substantive `no_consensus` review to the origin. It runs in a service environment whose inherited `PATH` omits the private Node installation, proving the configured CLI launches through the installed runtime boundary.

The negative journey proves that ordinary discussion, mentions, routine verification, ambiguous wording, and agent-authored suggestions neither start deliberation nor incur provider work. It also proves provider-call, exact observed-token, elapsed-time, and missing-observation budget failure without launching a later turn. Every peer agent runs on the publication-lineage-capable runtime. An automatically discovered peer cannot reset automation depth or answer an observation-only artifact. A partial rollout is not installed acceptance. Product messages contain no internal IDs, zero-artifact receipts, raw process failures, or canonical-history repair instructions.

The same scenarios pass through a non-Discord host adapter. A first-party surface may provide a richer decision room but consumes the same commands, artifacts, evidence, and terminal meanings.

## Consequences

Lervo retains an evidence-bound decision capability without imposing its cost and latency on every collaborative turn. Product work shifts from rebuilding deliberation to origin correlation, participant projection, usable decision presentation, budget visibility, search, and installed acceptance.

## References

- [Provider-neutral deliberation](../../coordination/deliberation/0019-provider-neutral-deliberation.md)
- [Installed managed deliberation](../../coordination/conversations/0392-installed-proactive-signals-and-deliberation.md)
- [Natural deliberation](../../coordination/conversations/0415-natural-deliberation-and-consistent-failure-evidence.md)
- [Product surfaces](../../../specifications/execution/product-surfaces.md)
- [Discord-first reference product](../../../roadmap/product-outcome-convergence/host-products/discord-first-reference-product.md)
