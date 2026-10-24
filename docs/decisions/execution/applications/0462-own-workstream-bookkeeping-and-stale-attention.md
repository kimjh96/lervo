# ADR-0462: Own workstream bookkeeping and stale attention on the server

Status: `accepted`
Decision date: 2026-10-05
Amended by: [ADR-0526](../orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md) (each branch records its own HEAD)
Amends: [ADR-0199](../../knowledge/repository/0199-structured-workstream-continuation-state.md), [ADR-0361](0361-project-operating-attention-without-new-authority.md), and [ADR-0451](../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)

## Context

Three defects surfaced in a downstream repository using Lervo terminal hooks:

- `UserPromptSubmit` projected workstream decisions, approvals, and blockers as current, blocking, user-owned items without checking freshness. Retrieval context directed agents to present blocking approvals in the same turn. Agents requested approval for a retired risk-increasing campaign, and a repository could receive the same four outdated blockers on every prompt.
- `lervo workstream update` stored caller-supplied `updatedAt`. Agents copied the previous value, freezing it across four revisions; no signal compared snapshots with repository activity.
- Updates required a complete snapshot, caller-incremented revision, and separate `--apply <plan-id>` call. The 32-note limit rejected excess notes instead of rolling them. `--help` failed with an unknown-option error.

## Decision

### Server-owned bookkeeping

`lervo workstream start` and `lervo workstream update` stamp write facts on the service side:

- `updatedAt` is the write time; caller values are ignored.
- `revision` is the current revision plus one. Callers may omit it. A supplied value must equal the next revision or block with `invalid_revision`, preserving its use as an optimistic-concurrency assertion.
- `schemaVersion`, `workstreamId`, and `origin` carry forward from the current snapshot. Supplied differences block with `identity_changed` or `origin_changed`.
- `repositoryHead` records the repository HEAD observed at the write.
- Notes retain the newest 32 entries. `droppedNoteCount` accumulates older notes removed by retention, and the CLI reports the count for the revision. Nothing is silently truncated.

`lervo workstream update` accepts `--patch <json>` or `--stdin-patch`: an RFC 7386 JSON merge patch over the current snapshot. Objects merge, arrays are replaced, and `null` deletes. A top-level `appendNotes` string array appends notes after the merge. `--from` and `--stdin` still accept complete snapshots, now without bookkeeping fields.

Plan/apply semantics remain exact. A plan ID binds the current snapshot content hash and semantic intent: the desired snapshot without `updatedAt` and `repositoryHead`. A later `--apply <plan-id>` reproduces that ID despite different clock and HEAD observations, but fails if the current snapshot or intent changed. `--apply-now` plans and applies the same plan in one call, recording the same `workstream.snapshot.recorded` event and change kind. A start draft derives its workstream ID from the semantic draft, so stamped time does not change identity.

Programmatic callers passing exact snapshots, such as supervision goal completion, retain exact-content planning. Only the authored path stamps bookkeeping.

`lervo workstream`, `current`, `start`, and `update` accept `--help` and `-h`, print usage, and exit 0.

### Staleness

A snapshot is `stale` if any rule holds:

- `updatedAt` is older than `staleAfterHours` (default 48).
- Recorded `repositoryHead` is more than `staleAfterCommits` commits behind current HEAD (default 20).
- Recorded HEAD is not an ancestor of current HEAD, or Git cannot resolve it.
- `updatedAt` is more than five minutes in the future.

Snapshots predating HEAD recording use the age rule alone. The optional `workstream` section in `.lervo/knowledge/policy.yaml` configures both thresholds:

```yaml
workstream:
  staleAfterCommits: 20
  staleAfterHours: 48
```

A stale snapshot makes every blocker, pending decision, pending approval, and next action stale. Each stale attention item has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and the instruction "Re-verify against the repository before acting; do not present as current."

Workstream approvals and decisions carry a consequence class. Approval kinds map to `repository_write`, `deployment`, or `external_effect`. Decisions have no structured class and are `unclassified`; Lervo never classifies free text. Under the repository invariant on consequential effects, every class—including `unclassified`—is consequential. Stale approvals and decisions are never rendered as directives; terminal and context renderings withhold their question or summary text.

### Hook output

- Compact context excludes stale items, printing only "N stale workstream items need re-verification: `lervo workstream current`." It omits the stale snapshot's next action and decisions.
- The same-turn presentation directive appears only when a listed item is current, user-owned, blocking, and requires user action.
- The entire compact context has a hard 4 KiB budget. The preamble takes priority; the workstream section receives the remaining bytes, and its recorded delivered byte count reflects truncation. This exceeds the normal 2 KiB size because the synchronous turn-declaration contract alone is about 2 KiB while no background knowledge owner is healthy.
- Retrieval mode applies the same staleness rules to the attention section and full workstream context, and caps the attention section at 4 KiB.
- Truncation retains the longest whole-character prefix and appends a deterministic marker naming the budget and inspection commands.

## State and field contracts

| Name | Required fields | Privacy | Failure meaning |
| --- | --- | --- | --- |
| Optional snapshot `repositoryHead` | `commit` (40 to 64 hex characters), `observedAt` | Commit ID and time only; stays in local snapshot state and CAS, never event payloads | Absent outside Git or before the first commit; staleness then uses age alone |
| Optional snapshot `droppedNoteCount` | Non-negative integer | Count only | Absence means no note was dropped |
| Workstream attention `state: "stale"` | Existing item fields plus `consequence` on approvals and decisions | Report retains bounded text for explicit inspection; hook renderings withhold stale approval and decision text | Needs re-verification and grants no authority |
| `invalid_patch` update blocker | `code`, `message` | Message names only the invalid shape | Patch or snapshot is not a JSON object, or `appendNotes` is not a string array |
| Optional `workstream` policy section | `staleAfterCommits` (1 to 100000), `staleAfterHours` (1 to 8760) | Repository policy | Invalid section fails policy validation |

No new event type is introduced. `workstream.snapshot.recorded` retains its payload.

## Consequences

Agents record revisions with one command, for example `lervo workstream update --actor agent --provider claude --patch '{"nextActions":["..."]}' --apply-now`. Recorded times reflect real writes, enabling freshness assessment. Outdated authority requests no longer reach prompts as current directives.

Older Lervo nodes reject snapshots containing `repositoryHead` or `droppedNoteCount` because the v1 schema forbids additional properties. Replicated nodes must upgrade together.

## Verification

Focused tests cover staleness boundaries, consequential stale approvals never becoming directives, compact and retrieval byte caps, merge-patch semantics, server-side `updatedAt` and `revision`, rolling notes, `--help` exit status, and equal events for one-call and two-step apply.
