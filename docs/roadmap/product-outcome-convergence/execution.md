# Prime-Agent-derived execution outcomes

Part of [Product outcome convergence](../product-outcome-convergence.md); its baseline, acceptance states, and claim boundaries apply.

## Bounded work graph

State: `implemented`

Outcome: bounded work forms a graph; verification, retry, resource, approval, and completion policy govern each attempt.

Evidence: assignment DAG projection, pure controller decisions, manual `loop run`, managed attempts, verification, leases, completion reconciliation, and exact managed token-dimension and per-run duration budgets exist.

Preserve the installed manual journey, fail-closed observation boundary, and non-autonomy claim.

## Root and recursive worker contracts

State: `implemented`

Outcome: root agents and recursive workers retain identity, ancestry, authority, path-conflict protection, and evidence.

Evidence: workforce and isolated-workspace contracts cover parent identity, delegation depth, leases, path scope, sealing, integration, and handoff.

Keep root and subagent contract tests common.

## Portable attach, detach, and resume

State: `implemented`

Outcome: long-running assignments attach, detach, and resume through repository-owned state without provider conversation memory.

Evidence: Worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Installed cross-provider continuation proves this portable boundary without claiming restored conversation memory.

Preserve repository-level continuation as the portable contract.

## Provider-native session resume

State: `external dependency`

Outcome: an adapter restores provider-native conversation memory for the same session.

Dependency: Codex and Claude report native `sessionResume: unsupported`. Acceptance requires a provider transport exposing native resume and independent evidence of restored state.

Add adapter-specific native resume only when that external capability exists. Keep it optional; it must not replace portable repository checkpoints.

## Durable repository goal lifecycle

State: `implemented`

Outcome: repository goals have a durable lifecycle instead of disconnected prose.

Evidence: the verified workstream remains root-goal authority; its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start.

Preserve explicit workstream completion and false authority flags. Independent nested goals, dynamic topology, and unattended scheduling remain separate unsupported capabilities.

## Runtime liveness through heartbeats

State: `implemented`

Evidence: direct worker writers record bounded last-seen observations. Root agents record explicit v2 heartbeat events without mutating identity or releasing authority. Managed adapters emit separately bound v2 provider-process observations after start, after terminal turns, and after stream drainage before shutdown.

`application liveness` and protocol-v3 `operating_liveness.inspect` expose both evidence families as separate installed, read-only collections. Codex app-server directly reports owned child-process state; Codex Responses and Claude SDK preserve explicit unobservable gaps.

Preserve point-in-time and false-authority meanings. Add native process-state support only where provider transport exposes direct evidence. Never infer continued health or termination from root reports, session registration, recent events, silence, or unobservable results.

## Bounded autonomous continuation

State: `delivery required`

Outcome: bounded autonomous continuation runs without repeated manual triggers.

Evidence: the governed loop is deliberately manual; the product-host protocol declares unattended scheduling unsupported.

Acceptance requires a reviewed scheduler binding current checkpoints, budgets, leases, retry limits, cancellation, uncertain effects, escalation, and a kill switch.

## Direct agent communication

State: `implemented`

Outcome: agents communicate directly while preserving authority.

Evidence: an installed reviewed direct-message adapter binds one content-addressed message to current mention and handoff authority through exact plan/apply. Source-event replay is idempotent. The exact active recipient-agent coordinate can record acknowledgment without claiming human authentication; delivery and action remain separate and unobserved.

Preserve the packed trigger-to-handoff-to-acknowledgment journey and its reviewed-input, no-live-platform, no-provider-start claim boundary.

## Runtime portable-skill candidates

State: `implemented`

Outcome: independently verified repeated workflows become reviewable portable-skill candidates.

Evidence: terminal finalization creates a CAS-bound development-pattern candidate only from independently grouped current sources and distinct passed verification events. The installed journey covers exact review, supersession, promotion, authorization, migration, activation, invocation, completion, and post-promotion observation.

Preserve exact source, verification, skill, resource, input, output, tool, permission, provider, platform, and role contracts. Retrieval selection alone never establishes candidacy.

## Explicit durable-instruction intake

State: `implemented`

Outcome: an explicit eligible runtime instruction becomes a reviewable durable repository-instruction candidate through an installed intake route.

Evidence: `knowledge instruction intake` invokes current-provider no-capability grounding only at the explicit command boundary, persists a bounded local candidate without raw request text, and exposes exact Markdown and candidate hash. `knowledge instruction review` requires the exact hash and reviewer identity to apply or reject. Apply rechecks the unchanged complete catalog and deterministic plan, writes only the generated instruction, emits the existing privacy-bounded materialization event, removes the active candidate, and becomes retrievable after the standard knowledge migration. Installed tests cover wrong-hash rejection, apply, reject, pending classification, event evidence, and fresh query retrieval while direct hooks retain zero automatic materialization.

Preserve the explicit candidate-review boundary, bounded active-state retention, recoverable post-event cleanup, and ADR-0327 retrieval-only direct hook.

## Agent-profile candidates

State: `delivery required`

Outcome: eligible runtime evidence becomes a reviewable agent-profile candidate.

Evidence: no agent-profile candidate lifecycle or installed intake route exists.

Define profile ownership, candidate evidence, exact review, activation, supersession, effect observation, and rollback before installing the route.
