# Discord and host acceptance

## Completion rule

Source, unit, fixture, CLI, or protocol evidence alone does not complete a Lervo-owned product capability. Completion requires:

1. Focused core and adapter contract evidence.
2. One real installed Discord journey using production transport and current source.
3. A host-neutral conformance scenario runnable without Discord-native behavior.

The future first-party surface must pass the third scenario and the same semantic acceptance. It may improve interaction and presentation without changing authority, evidence, or failure meanings.

## First installed vertical slice

One ordinary natural-language goal in a real Discord channel must:

- Bind the human, source message, conversation, organization, team, and supervision owner.
- Let the owner reuse qualified staff or hire and assign within policy.
- Let multiple named agents participate according to role relevance without uncontrolled loops.
- Execute authorized repository work, recover bounded known-safe failures, and obtain independent acceptance plus repository verification.
- Continue after service restart and after a reviewed source handoff while the original Mac is offline.
- Show meaningful progress, blockers, approvals, and terminal status in the originating thread.
- Return the verified result and artifacts to that thread exactly once.
- Complete verified hand-back without silently pushing, merging, discarding, or overwriting user bytes.

The positive journey permits no repeated human dispatch, routine failure inspection, or recovery prompting. Any required authority decision must be stated once with the exact bounded choice.

## Surface projections

| Product capability | Discord reference experience | Future first-party experience |
| --- | --- | --- |
| Multi-agent conversation | Named bot or webhook speakers, replies, threads, mentions, and bounded autonomous participation | Native named participants over the same participant and turn contracts |
| Activity feed | Coalesced thread updates or embeds for reads, edits, commands, verification, blockers, approvals, and outcomes | Filterable live feed with the same event coordinates and redaction |
| Unified search | Natural query returning grouped, source-linked results | Search view over the same typed result contract |
| Result publication | Durable reply to the originating thread with artifact links | Origin-bound result panel or conversation reply |
| Source lifecycle | Visible handoff, divergence, readiness, and hand-back states | Source-control view over the same receipts |
| Live steering | Natural actions or reviewed interactions for amend, pause, resume, cancel, approve, retry, and reassign | Native controls invoking the same commands |
| Formal deliberation | One bound decision thread with named or role-labeled proposal, objection, verification, and terminal result updates | Decision room over the same artifacts, policy, evidence, and outcome |
| Canvas | Pinned versioned collaboration artifact and discussion thread | Rich editable canvas over the same artifact lifecycle |
| Workflow | Thread-visible routine or graph state and reviewed actions | Visual workflow editor over canonical assignment routines and graphs |
| Files and media | Discord attachments or links bound to Lervo artifact evidence | Native upload and preview with identical hashes, privacy, and relations |
| Operating view | Bounded status summaries and drill-down links | Unified interactive objectives, staff, work, blocker, approval, verification, usage, and cost view |

Discord need not imitate a future UI pixel for pixel. It must expose the same material state, action, failure, and result meaning in usable native form.

## Acceptance evidence

Every installed journey records:

- Exact Lervo release and source revision, product-host protocol, surface-adapter build, repository revision, event schema, and search engine and adapter build.
- Provider and model, role and policy hashes, and document coverage stages.
- Resource descriptor and completeness, token and typed cache observations, and stage profile.
- Source handoff receipts, result digest, delivery observation, and verification outcome.

Human-visible messages exclude internal coordinates unless diagnostics are explicitly requested.

## Installed readiness

The installed-runtime preflight accepts an optional supervision health component only when it is
`ready`, explicitly `disabled`, or dormant with the exact `workstream_inactive` reason. A bounded
`unavailable` supervision component makes the aggregate not ready and preserves its fixed failure
and reason codes for operator diagnosis. This keeps the preflight aligned with the node health
contract without treating active supervision failure as a healthy installation.

## Publication verification failures

The response attempt stores only an existing bounded failure code, not rejected prose, artifact content, provider output, or native error text. A typed writing gate failure records `response_writing_blocked`; evaluator unavailability records `response_evaluation_unavailable`; verified artifact storage failure records `response_storage_unavailable`; deterministic artifact, evaluation, permit, or writing-contract mismatch records `response_contract_invalid`; and an unresolved post-effect or supervision-admission state records `response_effect_unconfirmed`. The last code never authorizes repository-work replay; only exact-source idempotent supervision admission may use the existing bounded retry path. Its terminal status tells the requester not to repeat the effect before inspection. Unknown verifier errors remain `publication_verification_failed` rather than being guessed into a more specific cause. The installed private log may record only bounded error name and code coordinates. A nonretryable contract mismatch uses the existing verified terminal-failure reply immediately when available; retryable failures keep the configured attempt bound. Historical generic failure rows cannot be retroactively diagnosed from that code alone and do not satisfy an installed success claim.

## Delivery uncertainty and reconciliation

The interaction outbox never retries indefinitely. It uses a bounded delivery-attempt count and stores `attention_required` when an invalid receipt or exhausted adapter failure prevents a verified acknowledgement. The state carries only immutable outbound coordinates, the attempt count, bounded failure code and time, and no delivery receipt; it is not a success claim. A Discord operator recovery must observe the existing message under the configured bot or webhook principal, channel, exact content hash and byte count, delivery time, and supported native reply relation before recording the replay, correlation, and outbox receipt. It must not send another message. [ADR-0424](../../../decisions/coordination/conversations/delivery/0424-bound-delivery-uncertainty-and-reconciliation.md) defines the state, privacy, migration, and failure meanings. The held two-direction installed approval remains independent of one recovered delivery.

Before a bot REST response becomes a delivery receipt, the returned message must match the requested channel, exact content, and native reply target; any returned nonce must match when present. A successful HTTP status or repeated Discord nonce alone does not prove publication of this outbound. A mismatched response remains uncertain and must not be acknowledged or silently resent. Installed acceptance checks both correct bot replies and a controlled same-nonce earlier-message response.

## Natural requested-runtime control

An ordinary message such as a request to open or close a development server may select a
repository-configured runtime from the current conversation, durable agent identity, and bounded
prior turns. The user does not need to know a runtime ID, effect name, command, working directory,
or process manager.

Execution remains configuration-bound and allowlisted. A provider may select only an advertised
action and configured target; it cannot invent an executable, arguments, environment, restart
policy, or readiness rule. The runtime manager starts the target only after an authorized request,
observes its configured readiness contract, applies its maximum lifetime, and never converts that
request into boot enablement or unconditional restart. The child receives the Node service
environment with the configured executable directory prepended to `PATH`, so nested lifecycle
commands resolve consistently without depending on an interactive shell.

After the action completes or fails, the effect adapter returns only bounded observed facts such as
started and ready, already running, stopped, already stopped, startup exit, startup timeout, or an
unclassified start or stop failure. It must not expose thrown provider text, filesystem paths, or
credentials. The same durable agent that owns the conversation then writes the human-facing reply
in the message language and its established voice. Fixed application-specific public response
templates and generic response-contract failure text do not satisfy this contract.

Publication verifies that reply with the same adaptive conversation-writing contract used for an
ordinary agent response. Tests must cover successful and failed effects, privacy-bounded failure
projection, no automatic startup, target isolation, and the installed open/readiness/close journey.

Measures include completion, human interventions, redundant hires, duplicate effects, recovery time, end-to-end and stage latency, provider calls, observed token dimensions, separately typed cache observations, search recall and unnecessary context, result-delivery success, and restart behavior. Unobserved cost remains unavailable. Improvement claims require a reviewed equivalent baseline.

## Platform limits

Creating Discord applications, issuing credentials, and authorizing guild installation remain owner or platform actions. Platform limitations may create a bounded external dependency for one native presentation feature, but cannot excuse an absent Lervo state or host-neutral contract.

Natural goal admission uses semantic intent. A Discord slash command may remain a diagnostic or compatibility entrypoint only when separately specified; it is not the product acceptance path.

## Optional formal decision journey

Formal deliberation is not required for every goal-to-result journey. A separate installed scenario must prove that an explicit authorized human request starts the configured policy exactly once, survives restart, renders each writing-gated stakeholder contribution as natural dialogue in the bound thread, keeps mechanical rounds, counts, and publication status in the activity projection, preserves per-role evidence and resources, and delivers one `converged` or `no_consensus` result to the origin.

A negative scenario must prove that ordinary multi-agent discussion, routine review and verification, ambiguous debate-related wording, role mentions, and agent-authored suggestions do not start formal deliberation. Configured conversation-wide notification and artifact-count-only status do not satisfy origin-bound acceptance.
