# ADR-0418: Retain deliberation as a bounded decision workflow

- Status: accepted
- Decision date: 2026-09-16

## Context

Lervo has a provider-neutral deliberation core with fixed proposer, reviewer, verifier, and decision-owner roles; structured proposal, objection, revision, verification, and decision artifacts; independent provider sessions; explicit convergence and `no_consensus`; and durable queueing, leases, restart recovery, reconciliation, and source-bound evidence. Discord can start it through an exact command or an explicit natural-language request when a default policy is configured.

Ordinary multi-agent chat cannot safely replace these capabilities: free-form agreement does not prove which sources participants read, whether blocking objections were resolved, or whether verification passed.

Installed integration remains incomplete. Deliberation can appear to overlap with ordinary multi-agent conversation despite requiring several managed provider and writing-evaluation turns. Terminal notifications fan out to configured conversations without proving delivery to the originating thread and expose status and artifact counts rather than a usable decision history. Policy roles are not explicitly related to visible hired-agent identities, and no deliberation-specific budget or observability view exists.

## Decision

Retain the deliberation domains, runtime, artifacts, queue, and evidence semantics. Present formal deliberation as an optional, high-assurance decision workflow above ordinary conversation and work execution, not as the default engine for multi-agent participation, routine review, repository verification, or every goal.

Use it when a human explicitly requests independent challenge, competing designs, consensus, or a policy-bound decision. A surface may recommend it for high risk, materially conflicting alternatives, or unresolved blocking objections, but recommendation grants no start authority. Initially, start, read, and resume authority belong to an explicitly bound human principal. Autonomous start requires a later reviewed principal, authority, and budget decision; ordinary agents cannot gain authority from a mention, role relevance, or model classification.

Before execution, bind the Lervo conversation, thread, source event, requester, policy ID and hash, and resulting deliberation ID. The origin projection joins the queue's durable source event to the immutable conversation-event target without creating another chat or origin store. Discord renders a bounded decision thread. The source conversation receives one start acknowledgment and one terminal result. Writing-gated projections place proposal, objection, revision, verification, and decision artifacts in the bound thread. Conversation-wide fan-out may remain as an operational fallback but does not complete the product contract.

Expose the validated queue binding through a read-only, host-neutral origin query. Terminal coordination uses its Lervo conversation, nullable thread, source event, and requester coordinates to create one deterministic reply signal. Legacy records without origins may use conversation-wide notification, while recording origin delivery as unavailable. A malformed binding is a queue-integrity failure. The query and result contain no native platform identifier, content, credential, or provider payload.

Create a terminal-notification obligation in the same SQLite transaction as queue settlement or authoritative reconciliation. Its states are `pending`, `leased`, and `accepted`:

- `pending` contains the project, deliberation, terminal summary, and immutable settlement time.
- `leased` adds only bounded worker, attempt, and expiry coordinates.
- `accepted` adds the normalized Lervo conversation-event ID and acceptance time, only after the interaction store durably owns the event and exactly one writing-gated outbound.

Zero or multiple responding policies leave the obligation unaccepted and expose a retryable configuration failure. After lease expiry, retry with the same settlement time and event identity. `accepted` does not prove platform delivery; only the interaction outbox and adapter delivery receipt can provide `originDeliveryCoordinate`. Missing routing or interaction ownership leaves the obligation retryable and fails the runtime cycle without rerunning deliberation.

On every reconciliation cycle, enumerate uncertain start and resume jobs from their durable queue with their immutable uncertainty time. Process-local attempt tracking bounds inspection within one runtime; durable time gives exhausted owner attention a stable conversation-event identity across restarts. Before publishing attention, check the append-only interaction inbox for the same logical source key, including records created with the earlier timestamp-derived identity. Restarted inspection must not replay provider execution or produce another Discord message for the same unresolved job. Inspection recovery does not prove a terminal outcome: only confirmed canonical history may settle the queue and create a terminal notification.

At start, resolve each policy role through organization deliberation-participant events to its exact durable participant, hired agent, and role revision when available. Label a policy-only execution role honestly; do not invent a hired-agent identity. Keep provider, model, run, session, context evidence, artifact, and verification coordinates independently observable.

Policies select decision stakeholders, not generic execution labels. The decision owner represents the requested outcome. Reviewers represent materially affected user, channel, core and knowledge, compatibility, operations, security, and observability concerns. Verification remains independent. One reviewer may cover several explicitly named concerns for a bounded decision. A provider name or the labels `proposer`, `reviewer`, and `verifier` alone are not stakeholder identities.

Natural-language replies are a separate presentation boundary from exact commands and operator diagnostics. Start replies omit queue IDs, artifact counts, checkpoint instructions, and zero-artifact receipts. Terminal `converged` and `no_consensus` replies recover and verify writing-gated final artifact bytes and return the substantive decision or last review to the originating conversation. Failure replies state only the user consequence and that no partial result was accepted; detailed process and reconciliation evidence remains in activity, trace, doctor, and exact diagnostic routes.

Presentation is language- and origin-aware. The originating human message selects English or Korean, and managed deliberation uses the matching versioned conversation writing contract for proposals, independent reviews, verification explanations, revisions, and decisions. A stored workflow may own localized participant presentation names; the execution plan selects the request language before recording artifact events, so Discord never has to translate a canonical role ID or an English label on its own. Deterministic status text uses the same language; repository documentation remains English by default.

A failed semantic publication attempt passes its exact failed check IDs into one bounded repair attempt. Plain-language repair treats topic and shared-artifact wording as evidence rather than text to copy, removes avoidable internal names, and explains every retained repository-relative path in reader-facing terms in the same sentence. An evaluator invocation that fails or returns an invalid contract is not treated as a prose defect and does not spend another writer turn. Synthetic signals retain their immediate source and original reply event so Discord answers the human request rather than publishing an unrelated standalone message. Bounded history retains recent human anchors separately from general recent turns so agent chatter cannot erase the design referenced by "this" or equivalent wording.

A read-only semantic evaluator may retry its existing artifact once when a managed child run fails at a retry-safe infrastructure boundary: repository snapshot, provider start, stream, turn, model availability, or result collection. The retry uses a fresh provider session and records existing `publication_evaluation` causality with attempt ordinal two. Do not retry contract-invalid output, capability or telemetry failures, or a completed negative writing judgment. Never rerun the writer for evaluator infrastructure recovery. Exhaustion fails closed without publishing the artifact.

The managed runner owns one cached repository-snapshot capture for the entire bounded workflow, including semantic-evaluator child runs. Every capture still walks the current repository, validates file identity before and after changed-file reads, and produces the same content-derived revision. Unchanged files reuse identity-bound hashes across child runs, avoiding independent full-repository reads under each proposal, evaluation, review, verification, or decision session's snapshot deadline.

Version-1 schemas and queue records retain their meanings. New conversation-started records add an immutable Lervo origin binding; legacy records remain readable without one. Queue upgrades backfill one pending notification obligation for an already settled record without changing its summary or settlement time.

New artifact events may contain the complete validated structured artifact alongside original summary coordinates. Old events remain readable without it. Duplicate coordinates must agree. Embedded artifacts exclude Markdown bodies, prompts, reasoning, provider responses, credentials, and native platform identifiers. This reader-first addition makes proposal, objection, revision, verification, and decision relationships rebuildable without an approved resume checkpoint.

New start events may contain the complete validated provider-neutral policy alongside the original policy ID, hash, participant roles, and round bound. Duplicate coordinates must agree. Policies contain no topic, prompt, reasoning, provider response, credential, or native platform identifier. A hash-only predecessor remains valid and is projectable only while a current source reproduces its exact recorded hash; policy drift is unavailable, not historical reinterpretation.

Policy hashes bind provider calls, tokens, elapsed time, and missing observations; checkpoints preserve consumption. Before any call, topic-ranked current sources form one exact-hash stakeholder bundle. Missing or changed evidence starts no provider. Time reserves finalization; a recorded failure returns as terminal `failed`.

Product-host protocol v11 installs the read-only composition. It opens current queue and interaction schemas without migration, freezes repository events and revision, validates policy, history, verification, organization, and resource relations, and distinguishes a writing-gated outbound from receipt-backed delivery. Reject multiple terminal outbounds, contradictory coordinates, count mismatches, or source changes during inspection. This protocol grants no workflow or delivery authority.

The installed Node composition projects each structured artifact into its bound thread while the long-running deliberation worker is still active. It verifies and republishes the writing-gated body under the language-selected, policy-bound participant name so the thread contains timely labeled stakeholder contributions rather than a delayed event dump or round and count summaries. Structured coordinates remain canonical activity and search data. Never copy prompts, private reasoning, unverified provider material, credentials, or platform identifiers. A fixed-contract responder adds no provider turn. A rebuildable cursor advances after one durable outbound; deterministic identity and existing replay cover crashes. Missing origins remain unprojected, while missing or mismatched content and ambiguous ownership fail closed.

Discord marks and bounds oversized observations to 2,000 characters while retaining the complete canonical artifact and outbound for search. Receipts prove that projection; human replies are never shortened. The same rule recovers older queued contributions.

An inconclusive authoritative inspection remains retryable until either canonical history proves a terminal state or the bounded attention publication is durably owned by the interaction store. Process-local exhaustion is recorded only after that ownership succeeds. A transient interaction or delivery failure therefore cannot silently discard the sole user-visible failure obligation.

## Product and knowledge boundaries

`converged` means the deliberation contract accepted a decision with required verification and no blocking objection. It does not approve repository work, authorize an external effect, or promote canonical knowledge. A converged decision may create a source-bound knowledge or work candidate through the existing review lifecycle. `no_consensus` selects no winner and promotes nothing.

Unified search may return authorized deliberation artifacts and outcomes as a distinct corpus. Activity and observability may show coordinates, statuses, provider usage, cached-input tokens, stage durations, publication attempts, and delivery evidence. They never expose hidden reasoning, prompts, raw provider payloads, credentials, or unrestricted artifact bodies.

## Removal and deprecation boundary

Do not remove the deliberation core or exact command route. The command remains available for diagnostics, exact policy selection, status, and recovery.

Remove these behaviors from product completion:

- automatically starting formal deliberation for ordinary multi-agent conversation;
- treating conversation-wide notification as origin-bound delivery;
- treating terminal status or artifact count alone as a usable decision result; and
- treating provider agreement, majority, or a converged artifact as canonical truth or effect authority.

## Acceptance

Installed Discord acceptance includes positive and negative journeys. The positive journey starts from an explicit human request, survives restart, shows named or honestly role-labeled stakeholders and structured artifacts in one bound thread, records separate per-role resource evidence, and delivers exactly one verified terminal decision body or substantive `no_consensus` review to the origin. It runs in a service environment whose inherited `PATH` omits the private Node installation, proving the configured CLI launches through the installed runtime boundary.

The negative journey proves that ordinary discussion, mentions, routine verification, ambiguous wording, and agent-authored suggestions neither start deliberation nor incur provider work. It also proves provider-call, exact observed-token, elapsed-time, and missing-observation budget failure without launching a later turn. Every peer agent runs on the publication-lineage-capable runtime, and an automatically discovered peer cannot reset automation depth or answer an observation-only artifact. A partial rollout is not installed acceptance. Product messages contain no internal IDs, zero-artifact receipts, raw process failures, or canonical-history repair instructions.

The same scenarios pass through a non-Discord host adapter. A first-party surface may provide a richer decision room but consumes the same commands, artifacts, evidence, and terminal meanings.

## Consequences

Lervo retains a differentiated, evidence-bound decision capability without imposing its cost and latency on every collaborative turn. Product work shifts from rebuilding deliberation to origin correlation, participant projection, usable decision presentation, budget visibility, search, and installed acceptance.

## References

- [Provider-neutral deliberation](../../coordination/deliberation/0019-provider-neutral-deliberation.md)
- [Installed managed deliberation](../../coordination/conversations/0392-installed-proactive-signals-and-deliberation.md)
- [Natural deliberation](../../coordination/conversations/0415-natural-deliberation-and-consistent-failure-evidence.md)
- [Product surfaces](../../../specifications/execution/product-surfaces.md)
- [Discord-first reference product](../../../roadmap/product-outcome-convergence/host-products/discord-first-reference-product.md)
