# ADR-0462: Own workstream bookkeeping and stale attention on the server

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0199](../../knowledge/repository/0199-structured-workstream-continuation-state.md), [ADR-0361](0361-project-operating-attention-without-new-authority.md), and [ADR-0451](../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)

## Context

Three defects surfaced in a downstream repository that uses Lervo terminal hooks.

- The `UserPromptSubmit` hook projected workstream decisions, approvals, and blockers as current, blocking, user-owned items with no freshness check. The retrieval context told the agent to present a blocking approval in the same turn. Agents therefore asked users to approve a risk-increasing campaign that had been retired, and a repository could receive the same four outdated blockers on every prompt.
- `lervo workstream update` stored the caller's `updatedAt`. Agents copied the previous value, so the recorded time stayed frozen across four revisions, and no signal compared the snapshot with repository activity.
- An update required a complete snapshot with a caller-incremented revision, a separate `--apply <plan-id>` call, and a 32-note limit that rejected rather than rolled. `--help` failed with an unknown-option error.

## Decision

### Server-owned bookkeeping

`lervo workstream start` and `lervo workstream update` stamp write facts on the service side:

- `updatedAt` is the write time. A caller value is ignored.
- `revision` is the current revision plus one. A caller may omit it; a supplied value must equal the next revision and otherwise blocks with `invalid_revision`, which keeps it useful as an optimistic-concurrency assertion.
- `schemaVersion`, `workstreamId`, and `origin` are carried from the current snapshot. A supplied different value blocks with `identity_changed` or `origin_changed`.
- `repositoryHead` records the repository HEAD observed at the write.
- Notes keep the newest 32 entries. `droppedNoteCount` accumulates how many older notes retention removed, and the CLI reports the count for the revision. Nothing is truncated silently.

`lervo workstream update` also accepts `--patch <json>` or `--stdin-patch`. A patch is an RFC 7386 JSON merge patch over the current snapshot: objects merge, arrays are replaced, and `null` deletes. A top-level `appendNotes` string array appends notes after the merge. `--from` and `--stdin` still accept a complete snapshot, now without bookkeeping fields.

Plan and apply semantics stay exact. A plan ID binds the current snapshot content hash and the semantic intent, which is the desired snapshot without `updatedAt` and `repositoryHead`. A later `--apply <plan-id>` invocation therefore reproduces the same plan ID even though its clock and HEAD observation differ, and it still fails when the current snapshot or intent changed. `--apply-now` plans and applies that same plan in one call and records the same `workstream.snapshot.recorded` event with the same change kind. A start draft derives its workstream ID from the semantic draft, so a stamped time does not change identity.

Programmatic callers that pass an exact snapshot, such as supervision goal completion, keep exact-content planning. Only the authored path stamps bookkeeping.

`lervo workstream`, `current`, `start`, and `update` accept `--help` and `-h`, print usage, and exit 0.

### Staleness

A workstream snapshot is `stale` when any rule holds:

- its `updatedAt` is older than `staleAfterHours` (default 48);
- its recorded `repositoryHead` is more than `staleAfterCommits` commits behind the current HEAD (default 20);
- its recorded HEAD is not an ancestor of the current HEAD, or Git cannot resolve it; or
- its `updatedAt` is more than five minutes in the future.

A snapshot that predates HEAD recording uses the age rule alone. The optional `workstream` section of `.lervo/knowledge/policy.yaml` configures both thresholds:

```yaml
workstream:
  staleAfterCommits: 20
  staleAfterHours: 48
```

A stale snapshot makes every blocker, pending decision, pending approval, and next action stale. A stale attention item has `state: "stale"`, `blocking: false`, `requiresUserAction: false`, owner `agent`, and the instruction "Re-verify against the repository before acting; do not present as current."

Workstream approvals and decisions carry a consequence class. Approval kinds map to `repository_write`, `deployment`, or `external_effect`. A decision has no structured class and is `unclassified`; Lervo never classifies free text. Following the repository invariant on consequential effects, every class, including `unclassified`, is consequential. A stale approval or decision is therefore never rendered as a directive, and terminal and context renderings withhold its question or summary text.

### Hook output

- Compact context excludes stale items. It prints only "N stale workstream items need re-verification: `lervo workstream current`." and omits the stale snapshot's next action and decisions.
- The same-turn presentation directive appears only when a listed item is current, owned by the user, blocking, and requires user action.
- The whole compact context has a hard 4 KiB budget. The preamble keeps priority, the workstream section receives the remaining bytes, and its recorded delivered byte count reflects any truncation. The budget exceeds the 2 KiB normal size because the synchronous turn-declaration contract alone is about 2 KiB while no background knowledge owner is healthy.
- Retrieval mode applies the same staleness rules to the attention section and the full workstream context, and caps the attention section at 4 KiB.
- Truncation keeps the longest whole-character prefix and appends a deterministic marker that names the budget and the inspection commands.

## State and field contracts

| Name                                         | Required fields                                                    | Privacy                                                                                                      | Failure meaning                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `repositoryHead` snapshot field (optional)   | `commit` (40 to 64 hex characters), `observedAt`                   | Commit ID and time only; stays in local snapshot state and CAS, never in event payloads                      | Absent outside Git or before the first commit; staleness then uses age alone       |
| `droppedNoteCount` snapshot field (optional) | Non-negative integer                                               | Count only                                                                                                   | Absent means no note was dropped                                                   |
| Workstream attention `state: "stale"`        | Existing item fields plus `consequence` on approvals and decisions | Report keeps bounded text for explicit inspection; hook renderings withhold stale approval and decision text | The item needs re-verification and grants no authority                             |
| `invalid_patch` update blocker               | `code`, `message`                                                  | Message names the invalid shape only                                                                         | The patch or snapshot is not a JSON object, or `appendNotes` is not a string array |
| `workstream` policy section (optional)       | `staleAfterCommits` (1 to 100000), `staleAfterHours` (1 to 8760)   | Repository policy                                                                                            | An invalid section fails policy validation                                         |

No new event type is introduced. `workstream.snapshot.recorded` keeps its payload.

## Consequences

Agents record a revision with one command such as `lervo workstream update --actor agent --provider claude --patch '{"nextActions":["..."]}' --apply-now`. Recorded times reflect real writes, so freshness can be judged. Outdated authority requests no longer reach prompts as current directives.

Nodes that run an older Lervo reject snapshots containing `repositoryHead` or `droppedNoteCount`, because the v1 schema forbids additional properties. Replicated nodes must upgrade together.

## Verification

Focused tests cover staleness boundaries, consequential stale approvals that never become directives, the compact and retrieval byte caps, merge-patch semantics, server-side `updatedAt` and `revision`, rolling notes, `--help` exit status, and equal events for one-call and two-step apply.
