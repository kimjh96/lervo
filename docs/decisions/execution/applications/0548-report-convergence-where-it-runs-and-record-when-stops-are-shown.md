# ADR-0548: Report convergence where it runs, and record when stops are shown

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0535](0535-project-core-health-with-actor-owned-attention.md) (convergence and longest-stop measures)
Related: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (convergence owner lease)

## Context

[ADR-0535](0535-project-core-health-with-actor-owned-attention.md) projects convergence health from the local maintenance observation and local stage history. Two observations on 2026-11-01 showed its limits.

- **A non-owner host showed an old stop.** WSL owns convergence for the shared repositories. The Mac checkout's local records still held a stop from 2026-10-29, when the Mac was last the owner. Every Mac terminal turn reported "knowledge stopped" with that old reason. WSL itself was queued and healthy.
- **Reporting time was never recorded.** The longest-stop measure always rendered `reporting unknown` with `attention_appearance_unrecorded`. No path recorded when a stop line first reached an owner turn. The core outcome "how long a stop went unreported" could not be measured.

## Decision

### A non-owner reports the owner's state

When the ADR-0466 fence says this host is not the owner (`waiting_owner`, `yielding`, or `contended`), the convergence measure no longer reads local stage records. It reads the owner peer's published continuity observation instead:

- `state: "owner_elsewhere"` and `owner: "resident on <host label>"`.
- A gap only when the owner's resident state is `attention` or `waiting`, with reason `owner_resident_<state>`.
- An owner observation older than 90 minutes, missing, or in the future is `unknown` with `owner_observation_missing_or_stale`. A local record never stands in for it.

### Owner turns record when a stop is first shown

The terminal prompt hook records a stop's first appearance after it records the prepared context. It records only when the exact convergence stop line is in the turn's prepared context. The private state file `.lervo/state/repository-health-appearance.json` holds:

- `schemaVersion: 1`
- `recordingSince`: the first owner turn after this change.
- `stops`: at most 64 of `{ since, reason, firstPreparedAt }`, keyed by the stop's start time, newest first.

This proves `prepared` delivery only: the line reached the turn context. It does not prove that the owner read it.

The longest-stop measure then reports:

| Case                                         | `reportedAt`        | `unreportedMilliseconds`             | Coverage                                   |
| -------------------------------------------- | ------------------- | ------------------------------------ | ------------------------------------------ |
| Shown                                        | first prepared time | first prepared time minus stop start | complete                                   |
| Started after `recordingSince`, never shown  | null                | whole stop duration                  | complete                                   |
| Started before `recordingSince`, or no state | null                | null                                 | partial, `attention_appearance_unrecorded` |

The terminal line says "first shown after <duration>", "never shown", or "reporting unknown".

## State, events, privacy, and failure meaning

- No event is added. The file is a bounded, deletable observation. The file has mode `0600` in a private directory, contains no paths or content, and is written atomically. It is rewritten only when it changes.
- A failed write loses only that observation and never blocks the prompt. Two concurrent turns can lose one entry; the next turn that shows the stop records it slightly later.
- A missing or invalid file makes reporting unknown again. It never makes a stop look reported.

## Verification

- `apps/cli/test/repository-health-projection.test.ts` covers the owner-elsewhere states and the three reporting cases.
- `apps/cli/test/repository-health-appearance.test.ts` covers starting the record, ignoring stops older than the record, keeping the first appearance, and the 64-stop bound.
- `apps/cli/test/repository-health.test.ts` covers the rendered wording.
