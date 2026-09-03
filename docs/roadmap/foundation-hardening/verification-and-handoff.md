# Foundation verification and enhancement handoff

Status: `complete`

As of: 2026-09-01

## Completion contract

Foundation hardening is complete only when FH0 through FH5 are accepted against one
published evidence bundle. Partial milestone completion is useful progress but does not
authorize durable loop or execution-graph work.

## Required proof matrix

| Area          | Required proof                                                        | Blocking failure                                            |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Authority     | one owner/projection/mutation map; no parallel task or truth store    | ambiguous or duplicated authority                           |
| Compatibility | v1 fixtures, mixed replay, reader-first rollout, upgrade and rollback | old history changes meaning or mutation precedes rejection  |
| Causality     | complete current managed work trees; typed legacy gaps                | orphan, cycle, cross-work child, or invented ancestry       |
| Resources     | complete or typed observations; deduplication and counter validation  | silent omission, fabricated zero, or misleading total/cost  |
| Performance   | profile-bound distributions and stage evidence                        | external ceiling reached or budget missed without exception |
| Reliability   | crash, retry, cancellation, duplicate, and recovery injection         | conflicting success/state or unsafe unknown-effect retry    |
| Concurrency   | admission, queues, fairness, leases, backpressure, and bounds         | unbounded growth, starvation, or conflicting ownership      |
| Security      | threat model, isolation, privacy, secret/cardinality tests            | implicit authority or unbounded third-party execution       |
| Capacity      | storage/CPU/memory profiles and retention/compaction                  | undocumented or unbounded collection                        |
| Drift         | frozen journeys before activation and bounded observation after       | unexplained semantic or quality regression                  |

## Evidence quality

Every result names the exact repository revision, event and report versions, provider
adapter version, environment profile, fixture or evaluation hash, population, observed
status, and unsupported cases. Percentiles without sample count and environment are
invalid evidence. A provider counter without its accounting descriptor is incomplete.

Claims retain their observation boundary:

- `selected`, `loaded`, `injected`, `referenced`, and `used` stay distinct;
- `provider_reported` is not `billed`;
- `unavailable` is not zero;
- a direct terminal query receipt is not whole-task usage;
- a successful hook response is not evidence that every lifecycle effect succeeded; and
- model output or repeated behavior is not proof that the model learned correctly.

The versioned automatic repository suite keeps ordinary graph-visible source changes on bounded
related tests and escalates known static-graph blind spots to full local regression testing. The
escalation policy covers repository execution scripts, runtime-loaded files, workflow definitions,
and test or workspace configuration; it does not convert local regression success into evidence of
external-provider, network, packaging, or release behavior. Each suite version retains its own
identity and evidence meaning.

## Review checkpoints

Review occurs at three irreversible boundaries:

1. **Before v2 reader merge:** schemas, privacy, failure codes, and old-history behavior.
2. **Before v2 writer activation:** every reader capability, mixed replay, backup,
   upgrade, and rollback evidence.
3. **Before enhancement handoff:** full readiness bundle, open limitations, budgets,
   threat model, and current golden journeys.

The first two checkpoints may block only their next transition. The final checkpoint
blocks loop and graph implementation.

## Handoff to enhancement

Foundation handoff was accepted on 2026-09-01 after FH0 through FH5 and three consecutive
complete source-bound readiness observations passed. Enhancement work may now begin only
through the separate governed-loop and bounded assignment-graph roadmap described below;
acceptance does not grant unattended execution or third-party-code authority.

When the foundation evidence is accepted, enhancement begins with a separate roadmap and
decision for one governed-loop and bounded assignment execution graph. It reuses:

- `workId` for causal aggregation;
- workstream and assignment for objective and delegated-work authority;
- managed run for attempts;
- existing leases, approvals, verification, event append, CAS, and recovery;
- resource and stage evidence for retry and escalation decisions; and
- public projections for a minimal local operating client.

The first slice must include one parallel branch and join, an approval gate, bounded
retry, cancellation, exhausted resource policy, crash recovery, block, and escalation.
The graph is declarative or rebuildable; observed completion remains canonical in
events, repository state, and verification.

Paperclip-like goals, routines, boards, and budgets and Buzz-like rooms, mentions,
inboxes, threads, and connectors follow as application commands and projections. They
do not gain direct storage access or presentation-derived authority.

## Future flexibility

New AI models, provider APIs, harnesses, context strategies, retrieval methods, memory
techniques, skills, tools, MCP servers, and UI hosts remain replaceable adapters. A new
technique must declare its versioned port, observations, privacy, failure meaning,
compatibility, evaluation, activation, rollback, and supersession. Trend adoption cannot
weaken local operation, historical interpretation, or verified repository authority.
