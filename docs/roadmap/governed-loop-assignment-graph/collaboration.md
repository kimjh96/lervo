# Assignment collaboration and connectors

These completed bounded manual slices share the [roadmap's responsibility boundaries and non-goals](../governed-loop-assignment-graph.md).

## GLA6: Assignment interactions, mentions, and inboxes

`assignment.handoff.recorded` remains the canonical route, without a collaboration database or second task authority. A provider-neutral mention plan resolves exact agent, unique active role, recorded manager, reviewer-role, or verifier-role targets. It binds the current workstream, assignment revision, source agent, lease, request digest, artifact coordinates, and context evidence. Exact apply delegates to the existing workforce handoff transition.

The storage-free application contract and pure work-controller projection rebuild deterministic assignment threads and recipient inbox items from current-workstream handoffs. They exclude bodies and distinguish recorded routing from unobserved delivery and acknowledgment. Read-only CLI routes and the local board consume the same report. External connectors, team expansion, provider switching, implicit assignment creation, and deliberation startup remain outside GLA6.

Acceptance requires focused tests for exact agent, unique role, and manager resolution; ambiguous, inactive, self, disallowed-role, workstream, and lease failures; exact plan/apply; content-free thread and inbox projection; missing identity invalidation; read-only CLI inspection; and no delivery or acknowledgment inference. Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA7: Exact assignment routines and manual triggers

Content-bound assignment templates support one explicit local manual trigger. The pure controller validates at most 32 acyclic nodes, exact role and optional capability bindings, and `skip_if_active`, `coalesce_if_active`, or bounded-enqueue admission. It derives deterministic invocation and assignment IDs and exposes an exact plan without template, acceptance, approval, or path prose.

Apply rechecks under a transient routine lock and delegates each node to existing workforce assignment creation. Routine provenance is additive assignment state and `assignment.created` metadata, not a second task or scheduler store. Multi-node apply is convergent: committed nodes remain canonical, deterministic replay is idempotent, and a fresh plan resumes only missing nodes. Materialization creates no lease and starts no provider.

Acceptance requires focused tests for deterministic DAG expansion, role and capability drift rejection, stale-plan blocking, idempotent creation, partial resume, capability-bound claim, skip/coalesce/enqueue distinctions, concurrency and capacity bounds, privacy allowlisting, and no arbitrary prompt execution or unattended trigger. Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA8: Authenticated assignment connector delivery

GLA8 binds one artifact from a canonical assignment handoff to a provider-neutral connector, internal destination, and content-bound chat publication permit. A pure route plan derives exact outbound and attempt identities without bodies or native platform identifiers. The stock CLI can plan locally but has no external-delivery authority.

Exact apply re-inspects an injected connector, fails on plan drift, and requires adapter authorization and durable reservation before its one external effect. Delivered, rejected, and unknown remain distinct observations. Exact replay returns a current durable observation; reservation conflict blocks; unknown is never retried automatically. No inbound room event creates, claims, approves, cancels, retries, completes, or starts an assignment.

Acceptance requires focused tests for exact deterministic planning; source, event, artifact, publication, connector, destination, and workstream blocking; malformed and contradictory evidence rejection; default no-authority behavior; inspect-before-reserve sequencing; durable reservation validation; idempotent current replay; and no second delivery. Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA11: Production Slack assignment connector

One production Slack adapter implements the GLA8 boundary without granting the stock CLI external authority. An authorized host explicitly composes credential, destination, artifact, writing-permit, durable-state, and transport ports. Core and route plans retain only internal coordinates and hashes; native Slack identifiers and the bot token remain adapter-private.

The adapter persists `reserved` before the effect and `sending` immediately before one Web API call. Delivered, rejected, and unknown are exact terminal outcomes. Restarting with `sending` records unknown and never automatically replays. The bounded SQLite store has explicit capacity failure and terminal-only retention. Shared conformance makes the safety behavior portable to future Discord, Teams, or other connectors.

Acceptance requires focused tests for common connector conformance; stable private inspection; descriptor, destination, credential, artifact, permit, and plan drift blocking; durable reservation before effect; exact Slack receipt mapping; rejected/unknown separation; restart and same-outbound non-retry; contradictory evidence rejection; state capacity and terminal retention bounds; and a full CLI host-injection dogfood journey using canonical handoff evidence, CAS artifact bytes, a full writing permit, SQLite state, and a controlled transport. Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent. Live workspace delivery remains an external authorization exercise, not a local acceptance requirement.
