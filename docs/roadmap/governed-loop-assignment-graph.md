# Governed loop and assignment graph

Status: `active`

As of: 2026-09-03

## Goal

Add bounded continuation and graph execution without creating a second task database,
weakening managed execution, or granting unattended authority. The first usable slice
replays current workstreams, assignments, managed-run causality, verification, resource
observations, and leases through one provider-neutral headless application contract.

```text
manual trigger -> verified checkpoint -> assignment decision -> managed attempt
               -> observe -> verify -> complete | retry | block | escalate
```

## Responsibility boundaries

| Boundary                        | Owns                                                            | Does not own                                   |
| ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `@lervo/application-contract`   | versioned graph, policy, decision, query, and command shapes    | storage, provider calls, CLI formatting        |
| `@lervo/work-controller`        | pure assignment/event projections and next-action decisions     | event append, leases, writes, scheduling       |
| `@lervo/agent-workforce`        | assignment state, dependencies, leases, handoff, and completion | provider execution or loop policy              |
| `@lervo/orchestrator`           | one managed attempt and its causal/resource/stage evidence      | multi-attempt policy or product presentation   |
| `@lervo/operating-client`       | pure board projection and static local presentation             | storage, policy, commands, or mutation         |
| CLI and future product adapters | trusted port composition and product presentation               | alternate graph, task, budget, or truth stores |

Events, CAS artifacts, assignment state, verification, and repository state remain
canonical. Graphs, loop decisions, and operating views are rebuildable projections.

## GLA1: First vertical slice

The first slice provides:

- one graph projection over current-workstream assignments, including roots, parallel
  ready nodes, joins, exact approval-requirement digests, leases, and attempt counts;
- cycle, self-dependency, duplicate, and cross-workstream dependency findings;
- one governed decision for claim, start, retry, approval wait, dependency wait,
  cancellation propagation, block, escalation, or completion;
- at most 16 attempts per assignment and 32 parallel assignments, with active attempts
  consuming capacity before another claim, start, or retry is recommended;
- exact provider and accounting-descriptor token admission thresholds without
  cross-provider or cross-descriptor addition or an advance-reservation claim;
- complete, partial, unavailable, and invalid resource handling, never inferred zero;
- assignment- and agent-bound causal root and retry records;
- fail-closed attempt-to-assignment and provider-resource attribution checks;
- manual `lervo loop status` and `lervo loop run` application routes over the same public
  contract; and
- provider-run success finalization only after verification and writing publication pass.

The controller retains no mutable loop state. Restart and resume replay existing
canonical state. A completed managed run whose assignment finalization outcome is not
observable becomes `completion_reconciliation_required`; it is not rerun automatically.

## Approval and cancellation limits

GLA2 adds the provider-neutral approval-authority port and requires exact assignment,
requirement-digest, evidence-hash, and validity-interval bindings. The default CLI still
provides no authority adapter, so an approval-gated assignment remains `await_approval`;
command-line text is not authority.

GLA2 also adds a content-addressed, revision-bound single-assignment cancellation plan and
the distinct `assignment.cancelled` transition. Only queued or blocked work is cancellable.
Leased work remains protected even after expiry because expiry does not prove provider
termination. Dependency propagation remains explicit and incremental rather than a hidden
multi-assignment transaction.

## GLA2: Authority and cancellation transition

The second slice provides:

- a storage- and provider-neutral approval authority query/observation port;
- fail-closed rejection of duplicate, foreign, malformed, or expired approval evidence;
- exact assignment-requirement matching rather than digest-only approval sharing;
- deterministic cancellation planning bound to current assignment revision and status;
- exact plan/apply CLI composition for requested and dependency-driven cancellation; and
- state/event rollback with the privacy-bounded `assignment.cancelled` event.

It does not add an approval issuer, infer model self-approval, cancel leased provider work,
or make the controller effectful.

## GLA3: Prepared completion reconciliation

The third slice records privacy-bounded completion preparation after managed verification and
writing-publication acceptance but before ordinary assignment finalization. A matching prepared
completion can be reconciled through an exact report-bound plan/apply transition without rerunning
provider work. Missing or stale preparation evidence remains escalation-required, and lease expiry
alone never turns a completed attempt back into claimable work.

GLA3 is accepted when focused tests prove canonical run and result binding, rejection of foreign
or malformed preparation, no reclaim after verified completion, explicit no-write planning,
exact stale-plan recheck, expired-original-lease recovery, and state rollback when reconciliation
event persistence fails. Quality, type, build, full tests, documentation and knowledge lifecycle,
foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA4: Minimal local operating client

The fourth slice adds a read-only graphical reference client over the exact governed-work report.
`@lervo/operating-client` has no storage, Hub, provider, or mutation dependency. It projects report
evidence into a board view model and renders deterministic self-contained HTML. The CLI supplies
that report through `lervo loop board`; the generated document contains no script, form, server,
network dependency, or state-changing control.

GLA4 is accepted when focused tests prove assignment and dependency projection, attempt, approval,
completion, action, and resource visibility, deterministic escaped HTML, explicit evidence
limitations, no mutation-port invocation, and invalid-report exit preservation. Quality, type,
package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and
task-base release completion must pass with reviewed minor release intent.

## GLA5: Current objective and observed token budgets

The fifth slice exposes the verified current workstream objective through a storage-free application
report and relates exact configured token admission limits to exact provider and accounting-group
resource observations. `lervo loop objective` reads no managed-work state; `lervo loop budget`
performs no mutation and reports partial, unavailable, invalid, or absent evidence as unknown. The
local board composes both independent reports and continues to escape prose and provide no controls.

GLA5 is accepted when focused tests prove verified objective translation, no managed-work query for
objective inspection, exact accounting-group matching, no unknown-to-zero conversion, observed
remaining-token projection, board prose escaping, and no mutation-port invocation. Quality, type,
package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and
task-base release completion must pass with reviewed minor release intent.

## GLA6: Assignment interactions, mentions, and inboxes

GLA6 reuses `assignment.handoff.recorded` as the canonical route instead of adding a collaboration
database or a second task authority. A provider-neutral mention plan resolves exact agent, unique
active role, recorded manager, reviewer-role, or verifier-role targets. It binds the current
workstream, assignment revision, source agent, lease, request digest, artifact coordinates, and
context evidence. Exact apply delegates to the existing workforce handoff transition.

The storage-free application contract and pure work-controller projection rebuild deterministic
assignment threads and recipient inbox items from current-workstream handoffs. They exclude bodies
and report route recording separately from unobserved delivery and acknowledgment. Read-only CLI
routes and the local operating board consume the same report. External connectors, team expansion,
provider switching, implicit assignment creation, and deliberation startup remain out of scope.

GLA6 is accepted when focused tests prove exact agent, unique role, and manager resolution;
ambiguous, inactive, self, disallowed-role, workstream, and lease failures; exact plan/apply;
content-free thread and inbox projection; missing identity invalidation; read-only CLI inspection;
and no delivery or acknowledgment inference. Quality, type, package-boundary, build, full tests,
documentation and knowledge lifecycle, foundation checks, and task-base release completion must
pass with reviewed minor release intent.

## GLA7: Exact assignment routines and manual triggers

GLA7 adds content-bound assignment templates and one explicit local manual trigger. The pure
controller validates at most 32 acyclic nodes, exact role and optional capability bindings, and
`skip_if_active`, `coalesce_if_active`, or bounded-enqueue admission. It derives deterministic
invocation and assignment IDs and exposes an exact plan without template, acceptance, approval, or
path prose.

Apply rechecks under a transient routine lock and delegates each node to existing workforce
assignment creation. Routine provenance is additive assignment state and `assignment.created`
metadata, not a second task or scheduler store. Multi-node apply is convergent: committed nodes
remain canonical, deterministic replay is idempotent, and a fresh plan resumes only missing nodes.
Materialization creates no lease and starts no provider.

GLA7 is accepted when focused tests prove deterministic DAG expansion, role and capability drift
rejection, stale-plan blocking, idempotent creation, partial resume, capability-bound claim,
skip/coalesce/enqueue distinctions, concurrency and capacity bounds, privacy allowlisting, and no
arbitrary prompt execution or unattended trigger. Quality, type, package-boundary, build, full
tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion
must pass with reviewed minor release intent.

## GLA8: Authenticated assignment connector delivery

GLA8 binds one artifact from a canonical assignment handoff to a provider-neutral connector,
internal destination, and content-bound chat publication permit. A pure route plan derives exact
outbound and attempt identities without bodies or native platform identifiers. The stock CLI can
plan locally but has no external-delivery authority.

Exact apply re-inspects an injected connector, fails on plan drift, and requires the adapter to
authorize and durably reserve before its one external effect. Delivered, rejected, and unknown
observations remain distinct. Exact replay returns a current durable observation, reservation
conflict blocks, and unknown is never retried automatically. No inbound room event creates,
claims, approves, cancels, retries, completes, or starts an assignment.

GLA8 is accepted when focused tests prove exact deterministic planning; source, event, artifact,
publication, connector, destination, and workstream blocking; malformed and contradictory evidence
rejection; default no-authority behavior; inspect-before-reserve sequencing; durable reservation
validation; idempotent current replay; and no second delivery. Quality, type, package-boundary,
build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release
completion must pass with reviewed minor release intent.

## GLA9: Verified post-promotion improvement observation

GLA9 pre-registers an exact evaluation protocol while a development pattern is reviewed, then
binds a post-promotion treatment observation to the same candidate, review, target, adapter, metric
set, and exact promotion event. The pure controller reports favorable, unfavorable,
no-material-difference, and insufficient observations with fixed version-1 policy.

Canonical events and CAS retain the protocol and comparison; the current view is a bounded
rebuildable projection. The stock CLI has no measurement authority, while an injected versioned
adapter verifies rate observations and keeps native evidence private. Attribution always remains
unestablished. Unfavorable evidence requires review and never authorizes automatic rollback,
self-modification, truth promotion, or a claim that a provider model learned.

GLA9 is accepted when focused tests prove pre-promotion registration, exact adapter reinspection,
baseline and treatment verification, timing and target drift blocking, deterministic comparison,
insufficient-sample separation, privacy allowlisting, default no-authority behavior, idempotent
event replay, rebuildable projection, and no automatic rollback. Quality, type, package-boundary,
build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release
completion must pass with reviewed minor release intent.

## GLA10: Bounded local improvement observation adapter

GLA10 adds a production local adapter without giving the stock CLI measurement authority. An
authorized host may collect a request from local canonical events, but exact register and observe
apply still re-inspect the narrower verification port and reproduce the reviewed evidence.

The first supported metric is repository-wide `verification_success`: passed canonical
verification completions divided by every valid completion in an inclusive window. Unsupported,
empty, and over-capacity measurements remain explicitly unavailable. Event scanning, pure metric
projection, receipt binding, project-storage lifetime, shared conformance, CLI injection, and CAS
protocol persistence remain separate responsibilities.

GLA10 is accepted when focused tests prove shared adapter conformance, exact counts and boundary
inclusion, count, phase, pattern, window, and backdated-evidence drift rejection, duplicate-evidence
failure, unsupported and empty abstention, scan and evidence capacity limits, safe storage close,
default no-authority behavior, and a full baseline-to-promotion-to-treatment CLI host-injection
dogfood journey. Quality, type, package-boundary, build, full tests, documentation and knowledge
lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release
intent.

## GLA11: Production Slack assignment connector

GLA11 turns the provider-neutral GLA8 boundary into one production Slack adapter without granting
the stock CLI external authority. An authorized host explicitly composes credential, destination,
artifact, writing-permit, durable state, and transport ports. Core and route plans retain only
internal coordinates and hashes; native Slack identifiers and the bot token remain adapter-private.

The adapter persists `reserved` before the effect and `sending` immediately before one Web API call.
Delivered, rejected, and unknown remain exact terminal outcomes. A restart that finds `sending`
records unknown and never automatically replays. The bounded SQLite store provides explicit
capacity failure and terminal-only retention. Shared conformance makes the same safety behavior
portable to future Discord, Teams, or other connectors.

GLA11 is accepted when focused tests prove common connector conformance; stable private inspection;
descriptor, destination, credential, artifact, permit, and plan drift blocking; durable reservation
before effect; exact Slack receipt mapping; rejected/unknown separation; restart and same-outbound
non-retry; contradictory evidence rejection; state capacity and terminal retention bounds; and a
full CLI host-injection dogfood journey using canonical handoff evidence, CAS artifact bytes, a full
writing permit, SQLite state, and a controlled transport. Quality, type, package-boundary, build,
full tests, documentation and knowledge lifecycle, foundation checks, and task-base release
completion must pass with reviewed minor release intent. Live workspace delivery remains an
external authorization exercise and is not required for local acceptance.

## GLA12: Exact repeated-failure observation

GLA12 adds `repeated_failure` as the second production local improvement metric. Every valid
canonical verification completion in the inclusive window is one denominator unit. A failed
completion enters the numerator only when its exact `suiteHash` and ordered
`nonPassedCommandIds` signature already occurred in that window. This establishes coordinate
recurrence, not a shared defect, root cause, causal improvement, semantic correctness, or model
learning.

Completion normalization, verification-success projection, repeated-failure projection, bounded
event scanning, receipt binding, storage lifetime, and CLI composition remain separate
responsibilities. The adapter descriptor is versioned, one snapshot supplies both metrics, command
identifiers are not copied into observation or effect artifacts, and existing version-1
lower-is-favorable comparison policy remains authoritative.

GLA12 is accepted when focused tests prove exact first-versus-later recurrence, suite and ordered
command-signature separation, passed and cancelled exclusion, valid zero observation, contradictory
coordinate rejection, empty and bounded-source abstention, shared conformance for both metrics,
exact re-verification, and a full two-metric baseline-to-treatment CLI host-injection journey.
Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle,
foundation checks, and task-base release completion must pass. Release intent is required only when
an embedding product adds this private adapter to a published artifact closure.

## GLA13: Explicit local improvement observation host

GLA13 packages the private local observation adapter in the installed CLI while preserving
per-command authority. `knowledge pattern effect collect --local-events` reads a version-1 bounded
request and emits the adapter descriptor, exact request coordinates, both supported observations,
explicit unavailable results, unestablished attribution, and a declaration that no canonical state
changed. Without the flag, collection fails before event-storage access.

The same flag supplies the local verifier to existing register and observe apply operations. It does
not replace the exact plan ID or `--write`; apply still re-observes the reviewed window before CAS or
event mutation. Adapter composition, collection, rendering, command parsing, canonical routing, and
storage remain separate. No metric, event, state store, background observer, provider authority,
automatic promotion, rollback, or model-learning claim is added.

GLA13 is accepted when focused tests prove versioned collection, explicit authority, exact
descriptor and two-metric output, unavailable propagation, no-mutation reporting, text rendering,
default no-authority behavior, full baseline-to-promotion-to-treatment comparison through the
installed host path, and packed CLI inclusion. Quality, type, package-boundary, build, full tests,
documentation and knowledge lifecycle, foundation checks, and task-base release completion must
pass with reviewed minor release intent.

## Non-goals

- unattended or timer-based scheduling;
- arbitrary graph cycles or agent-authored topology mutation;
- third-party code execution inside the controller;
- estimated money presented as billed cost;
- automatic approval, cancellation mutation, or uncertain-effect retry;
- a mutable Paperclip-like task database or Buzz-like collaboration database; and
- changing direct provider terminals from `unmanaged` to managed.

## Acceptance

GLA1 is accepted only when focused tests prove parallel roots and a join, exact retry
ancestry, approval blocking, cancellation propagation, resource exhaustion and missing
telemetry behavior, managed-run causal binding, CLI port composition, and no new
canonical store. Quality, type, package-boundary, build, relevant full tests,
documentation lifecycle, and task-base release-completion checks must pass with reviewed
minor release intent.

## Next sequence

1. Add a second connector only when a current product needs it, reusing shared conformance while
   keeping provider-native credential, destination, receipt, and recovery semantics in its adapter.
2. Add another improvement metric only after its counting unit, evidence source, ground truth,
   privacy boundary, and versioned policy are explicit.

## References

- [Foundation enhancement handoff](foundation-hardening/verification-and-handoff.md)
- [Agent platform evolution research](../research/lervo-agent-platform-evolution.md)
- [ADR-0336](../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0337](../decisions/execution/orchestration/0337-bind-assignment-approval-and-cancellation-authority.md)
- [ADR-0338](../decisions/execution/orchestration/0338-reconcile-prepared-managed-assignment-completion.md)
- [ADR-0340](../decisions/execution/orchestration/0340-add-read-only-local-operating-board.md)
- [ADR-0341](../decisions/execution/orchestration/0341-project-current-objective-and-observed-token-budgets.md)
- [ADR-0342](../decisions/execution/orchestration/0342-project-assignment-interactions-from-workforce-handoffs.md)
- [ADR-0344](../decisions/execution/orchestration/0344-deliver-assignment-artifacts-through-injected-connectors.md)
- [ADR-0345](../decisions/execution/orchestration/0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [ADR-0346](../decisions/execution/orchestration/0346-measure-improvement-effects-from-bounded-local-events.md)
- [ADR-0347](../decisions/execution/orchestration/0347-deliver-assignments-through-a-production-slack-connector.md)
- [ADR-0348](../decisions/execution/orchestration/improvement/0348-measure-exact-repeated-verification-failures.md)
- [ADR-0349](../decisions/execution/orchestration/improvement/0349-expose-local-improvement-observations-through-an-explicit-cli-host.md)
- [Assignment interaction specification](../specifications/execution/assignment-interactions.md)
- [Assignment connector specification](../specifications/execution/assignment-connectors.md)
- [Assignment routine specification](../specifications/execution/assignment-routines.md)
- [Verified improvement effects](../specifications/execution/verified-improvement-effects.md)
- [Verified improvement-effect dogfood](../evidence/pilots/verified-improvement-effect-dogfood.md)
- [Execution specification](../specifications/execution.md)
