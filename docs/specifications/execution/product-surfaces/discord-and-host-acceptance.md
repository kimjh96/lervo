# Discord and host acceptance

## Completion rule

A Lervo-owned product capability requires all three forms of evidence:

1. Focused core and adapter contracts.
2. A real installed Discord journey using production transport and current source.
3. A host-neutral conformance scenario runnable without Discord-native behavior.

Source, unit, fixture, CLI, or protocol evidence alone is insufficient. The future first-party surface must pass the host-neutral scenario and the same semantic acceptance. Interaction and presentation may improve without changing authority, evidence, or failure meanings.

## First installed vertical slice

One ordinary natural-language goal in a real Discord channel must:

- Bind the human, source message, conversation, organization, team, and supervision owner.
- Let the owner reuse qualified staff or hire and assign within policy.
- Involve multiple named agents by role relevance without uncontrolled loops.
- Execute authorized repository work, recover bounded known-safe failures, and obtain independent acceptance and repository verification.
- Continue after service restart and reviewed source handoff while the original Mac is offline.
- Show meaningful progress, blockers, approvals, and terminal status in the originating thread.
- Return the verified result and artifacts to that thread exactly once.
- Complete verified hand-back without silently pushing, merging, discarding, or overwriting user bytes.

The positive journey requires no repeated human dispatch, routine failure inspection, or recovery prompting. State each required authority decision once with the exact bounded choice.

## Surface projections

| Capability | Discord reference experience | Future first-party experience |
| --- | --- | --- |
| Multi-agent conversation | Named bot or webhook speakers, replies, threads, mentions, bounded autonomous participation | Native named participants using the same participant and turn contracts |
| Activity feed | Coalesced thread updates or embeds for reads, edits, commands, verification, blockers, approvals, outcomes | Filterable live feed with the same event coordinates and redaction |
| Unified search | Natural query with grouped, source-linked results | Search view using the same typed result contract |
| Result publication | Durable originating-thread reply with artifact links | Origin-bound result panel or conversation reply |
| Source lifecycle | Visible handoff, divergence, readiness, hand-back states | Source-control view using the same receipts |
| Live steering | Natural actions or reviewed interactions for amend, pause, resume, cancel, approve, retry, reassign | Native controls invoking the same commands |
| Formal deliberation | One bound decision thread with named or role-labeled proposal, objection, verification, terminal result updates | Decision room using the same artifacts, policy, evidence, outcome |
| Canvas | Pinned versioned collaboration artifact and discussion thread | Rich editable canvas using the same artifact lifecycle |
| Workflow | Thread-visible routine or graph state and reviewed actions | Visual workflow editor over canonical assignment routines and graphs |
| Files and media | Discord attachments or links bound to Lervo artifact evidence | Native upload and preview with identical hashes, privacy, relations |
| Operating view | Bounded status summaries and drill-down links | Unified interactive objectives, staff, work, blocker, approval, verification, usage, cost view |

Discord need not reproduce future UI pixels; it must expose the same material state, action, failure, and result meanings in usable native form.

Normal conversation effects publish only managed, context-grounded prose in the message language and durable agent voice. Application-authored complete-sentence templates cannot represent successful, duplicate, refused, or unavailable action results. A fixed public sentence is reserved for the separately verified terminal fallback when the managed writer itself is unavailable.

## Acceptance evidence

Every installed journey records:

- Exact Lervo release and source revision, surface-adapter build, repository revision, event schema, search engine and adapter build.
- Provider and model, role and policy hashes, document coverage stages.
- Resource descriptor and completeness, token and typed cache observations, stage profile.
- Source handoff receipts, result digest, delivery observation, verification outcome.

Human-visible messages exclude internal coordinates unless diagnostics are explicitly requested.

## Installed readiness

Installed-runtime preflight accepts optional supervision health only when `ready`, explicitly `disabled`, or dormant for the exact `workstream_inactive` reason. Bounded `unavailable` supervision makes the aggregate not ready and preserves fixed failure and reason codes for operator diagnosis. Preflight follows the node health contract; active supervision failure is not a healthy installation.

## Publication verification failures

Response attempts store only existing bounded failure codes, never rejected prose, artifact content, provider output, or native error text:

| Failure | Code |
| --- | --- |
| Typed writing gate | `response_writing_blocked` |
| Evaluator unavailable | `response_evaluation_unavailable` |
| Verified artifact storage | `response_storage_unavailable` |
| Deterministic artifact, evaluation, permit, or writing-contract mismatch | `response_contract_invalid` |
| Unresolved post-effect or supervision-admission state | `response_effect_unconfirmed` |
| Unknown verifier error | `publication_verification_failed` |

`response_effect_unconfirmed` never authorizes repository-work replay. Only exact-source idempotent supervision admission may use the existing bounded retry path. Its terminal status tells the requester not to repeat the effect before inspection. Do not guess specific causes for unknown verifier errors.

Installed private logs may record only bounded error name and code coordinates. A nonretryable contract mismatch immediately uses the existing verified terminal-failure reply when available; retryable failures retain the configured attempt bound. Historical generic failure rows cannot be retroactively diagnosed from that code alone and cannot support an installed success claim.

## Delivery uncertainty and reconciliation

The interaction outbox uses bounded delivery attempts, never indefinite retries. Invalid receipts or exhausted adapter failures preventing verified acknowledgement produce `attention_required`. This state contains only immutable outbound coordinates, attempt count, bounded failure code and time, and no delivery receipt; it claims no success.

Discord operator recovery must observe the existing message under the configured bot or webhook principal, channel, exact content hash and byte count, delivery time, and supported native reply relation before recording replay, correlation, and outbox receipts. Recovery must not send another message. [ADR-0424](../../../decisions/coordination/conversations/delivery/0424-bound-delivery-uncertainty-and-reconciliation.md) defines state, privacy, migration, and failure meanings. Held two-direction installed approval remains independent of one recovered delivery.

Before a bot REST response becomes a delivery receipt, its message must match the requested channel, exact content, and native reply target; any returned nonce must also match. Successful HTTP status or repeated Discord nonce alone does not prove this outbound was published. Mismatches remain uncertain and must neither be acknowledged nor silently resent. Installed acceptance checks correct bot replies and a controlled same-nonce earlier-message response.

## Natural requested-runtime control

An ordinary request to open or close a development server may select a repository-configured runtime from the current conversation, durable agent identity, and bounded prior turns. Users need not know runtime IDs, effect names, commands, working directories, or process managers.

Execution remains configuration-bound and allowlisted. Providers may select only advertised actions and configured targets; they cannot invent executables, arguments, environment, restart policy, or readiness rules. The runtime manager starts targets only after authorized requests, observes configured readiness, applies maximum lifetime, and never converts requests into boot enablement or unconditional restart. Children receive the Node service environment with the configured executable directory prepended to `PATH`, so nested lifecycle commands resolve consistently without an interactive shell.

After completion or failure, the effect adapter returns only bounded observed facts: started and ready, already running, stopped, already stopped, startup exit, startup timeout, or unclassified start or stop failure. It must not expose thrown provider text, filesystem paths, or credentials. The conversation's owning durable agent writes the human-facing reply in the message language and established voice. Fixed application-specific public templates and generic response-contract failure text do not satisfy this contract.

Publication verifies the reply using the adaptive conversation-writing contract for ordinary agent responses. Tests cover successful and failed effects, privacy-bounded failure projection, no automatic startup, target isolation, and the installed open/readiness/close journey.

Measures include completion, human interventions, redundant hires, duplicate effects, recovery time, end-to-end and stage latency, provider calls, observed token dimensions, separately typed cache observations, search recall and unnecessary context, result-delivery success, and restart behavior. Unobserved cost remains unavailable. Improvement claims require a reviewed equivalent baseline.

## Platform limits

Creating Discord applications, issuing credentials, and authorizing guild installation remain owner or platform actions. Platform limitations may create a bounded external dependency for one native presentation feature, but cannot excuse missing Lervo state or host-neutral contracts.

Natural goal admission uses semantic intent. Discord slash commands may be separately specified diagnostic or compatibility entrypoints; they are not the product acceptance path.

## Optional formal decision journey

Formal deliberation is optional for individual goal-to-result journeys. A separate installed scenario must prove that an explicit authorized human request:

- Starts configured policy exactly once and survives restart.
- Renders every writing-gated stakeholder contribution as natural dialogue in the bound thread.
- Keeps mechanical rounds, counts, and publication status in the activity projection.
- Preserves per-role evidence and resources.
- Delivers one `converged` or `no_consensus` result to the origin.

A negative scenario must prove that ordinary multi-agent discussion, routine review and verification, ambiguous debate wording, role mentions, and agent-authored suggestions do not start formal deliberation. Configured conversation-wide notification and artifact-count-only status cannot satisfy origin-bound acceptance.
