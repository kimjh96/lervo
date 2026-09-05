# Prime-Agent-derived execution outcomes

Part of [Product outcome convergence](../product-outcome-convergence.md); its baseline, acceptance states, and claim boundaries apply.

## Bounded work graph

State: `implemented`

Outcome: bounded work is a graph; verification, retry, resource, approval, and completion policy govern each attempt.

Evidence: assignment DAG projection, pure controller decisions, manual `loop run`, managed attempts, verification, leases, completion reconciliation, and exact managed token-dimension and per-run duration budgets exist.

Preserve the installed manual journey, fail-closed observation boundary, and non-autonomy claim.

## Root and recursive worker contracts

State: `implemented`

Outcome: root agents and recursive workers retain identity, ancestry, authority, path-conflict protection, and evidence.

Evidence: workforce and isolated-workspace contracts cover parent identity, delegation depth, leases, path scope, sealing, integration, and handoff.

Keep root and subagent contract tests common.

## Attach, detach, and resume

State: `partial`

Outcome: a long-running agent can attach, detach, and resume.

Evidence: Worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Codex and Claude report native `sessionResume: unsupported`; conversation memory is not restored.

Add adapter-specific native resume only with independent evidence; retain repository-level continuation as the portable fallback.

## Durable repository goal lifecycle

State: `implemented`

Outcome: a repository goal has a durable lifecycle instead of disconnected prose.

Evidence: the verified workstream remains root-goal authority; its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start.

Preserve explicit workstream completion and false authority flags. Independent nested goals, dynamic topology, and unattended scheduling remain separate unsupported capabilities.

## Runtime liveness through heartbeats

State: `implemented`

Evidence: direct worker writers record bounded last-seen observations. Root agents record explicit v2 heartbeat events without mutating identity or releasing authority. Managed adapters emit separately bound v2 provider-process observations after start, after terminal turns, and after stream drainage before shutdown.

`application liveness` and protocol-v3 `operating_liveness.inspect` expose both evidence families as separate installed, read-only collections. Codex app-server directly reports owned child-process state; Codex Responses and Claude SDK preserve explicit unobservable gaps.

Preserve point-in-time and false-authority meanings. Add native process-state support only where a provider transport exposes direct evidence. Never infer continued health or termination from root reports, session registration, recent events, silence, or unobservable results.

## Bounded autonomous continuation

State: `missing`

Outcome: bounded autonomous continuation runs without repeated manual triggers.

Evidence: the governed loop is deliberately manual; the product-host protocol declares unattended scheduling unsupported.

Before accepting an unattended journey, a reviewed scheduler must bind current checkpoints, budgets, leases, retry limits, cancellation, uncertain effects, escalation, and a kill switch.

## Direct agent communication

State: `implemented`

Outcome: agents communicate directly while preserving authority.

Evidence: an installed reviewed direct-message adapter binds one content-addressed message to the current mention and handoff authority through exact plan/apply. Source-event replay is idempotent. The exact active recipient-agent coordinate can record acknowledgment without claiming human authentication; delivery and action remain separate and unobserved.

Preserve the packed trigger-to-handoff-to-acknowledgment journey and its reviewed-input, no-live-platform, no-provider-start claim boundary.

## Runtime lesson candidates

State: `partial`

Outcome: runtime lessons become reviewable instruction, skill, or profile candidates.

Evidence: durable-instruction and development-pattern domain code exists; direct terminal intake is intentionally disabled, and no agent-profile candidate path exists.

Route outcome evidence to the correct candidate type; require exact review, activation, effect observation, supersession, and rollback.
