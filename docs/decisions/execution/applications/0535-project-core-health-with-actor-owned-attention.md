# ADR-0535: Project core health with actor-owned attention

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0451](../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0361](0361-project-operating-attention-without-new-authority.md), [ADR-0463](../../knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0467](../../knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)

Amended by: [ADR-0548](0548-report-convergence-where-it-runs-and-record-when-stops-are-shown.md) (a non-owner reports the owner's convergence; owner turns record when a stop is first shown)

## Context

Convergence stopped silently for one to two weeks while terminal prompts asked
the owner to review routine freshness and instruction-capture work. This reverses
the intended division of responsibility: the owner instructs, and Lervo performs
upkeep and independent review. Core-outcomes step 1 requires a small Know and Find
signal over existing state for one repository, before further outcome work.

## Decision

Replace compact review-chore lines with one health section, bounded to 520 UTF-8
bytes. Every observed gap names a Lervo actor or recovery condition. Fully
observed measures within target render no section, heading or age line. Missing,
stale, invalid or other-revision evidence is unknown, never an observed zero.
Truncation keeps whole lines and counts omitted lines and owner items.

The end of each CLI resident reconciliation (the host resident and `lervo knowledge
worker --watch`) computes a private, replaceable `.lervo/state/repository-health.json`. Resident
refresh includes skipped and failed cycles, after their heartbeat write. The new
terminal hook runtime contains no projection code, so the hook bundle
only grows by the reader and formatter. The
health reader reads the file and a bounded live resident heartbeat; it never
computes health or runs a provider or lint. Background workstream inspection
reads the bounded current snapshot and at most 10,001 typed provenance events,
without recovery. The pre-existing compact workstream path still scans events
and can recover state; removing that path is a bounded follow-up. The existing 8 MiB hook
runtime budget and 4 KiB complete compact-context cap remain in force.

Operating attention exposes the same projection through its existing application
command. Add actor, recommendation, exact inspect command, consequence and waiting
age to its items. Preserve original source guidance as `recordedInstruction`.
Routine review, held settled decisions, freshness stalls, publication recovery
and classification belong to the resident, reviewers, principal proxy or replica
coordinator. Attribution is responsibility, never proof of an active worker or a
valid mandate, and grants no permission to settle or write.

Only structured consequential effects remain owner-actionable: exact repository
write approvals, user-owned freshness writes, safety/policy changes, replica
overwrites, delegation/scope decisions, Hub scope grants (`hub_forbidden`) and
credential recovery (`hub_unauthorized`, `token_file_unreadable`). Existing
knowledge delegation grants no Hub credential or permission-management scope. An unclassified workstream question
belongs to the principal proxy for classification; its wording cannot establish
authority. Owner effects appear in one batch with a count, recommendations and
inspect commands. Currently read workstream approvals supersede cached
workstream items and join that batch even when the cache is missing or invalid.
No authority checks, exact review requirements or underlying
held states are removed. Independent review remains necessary before an effect.

## State, coverage and privacy

The [health contract](../../../specifications/execution/operating-attention/repository-health.md)
defines schema 1, source bounds, expiry, measures, failure meanings and attribution.
The file stores counts, relative paths, closed codes, timestamps and existing
attention metadata. It excludes prompt bodies, document content, provider output,
credentials and absolute host paths. The file is a projection, never canon or
an authorization record. Publication is atomic and private. A singleton SQLite
generation is claimed before reading sources; generation checking and rename
share one transaction, so an older computation cannot replace a newer result.
Failed publication leaves the old file to expire. It adds no event or telemetry contract.

Staleness evaluation and freshness-cycle summaries retain independent timestamps
and expiry. Losing the evaluated denominator does not remove valid cycle safety
counts or the first safety path. Authority classification and totals cover all
freshness candidates before the report's 256-item cap. Source expiry removes
old owner requests from the current batch. Incomplete coverage makes the overall
owner count null; `confirmedCount` preserves the verified portion, with exact
omissions and inspection commands. Ordinary original source items remain
inspectable. Prompt rendering keeps one collapsed unknown line and no raw event
counter dump.

Stage records can establish stop age; backlog age cannot substitute for it.
Existing records do not prove attention appearance, so reported time and
unreported duration remain unknown; render `reporting unknown`. No local
injection event means `last recorded injection unknown`. Future events cannot
close a current stop or contribute Find counts. Deferral age is also unknown when its source
has no timestamp. The lifecycle lint cache stores validity without link counts;
broken links remain unknown rather than triggering lint. Recorded Find event
counts describe local events, never semantic use, provider injection inferred
from hook preparation, precision or recall.

## Surfaces and completion

The application contract is provider and host neutral. Discord conversation
composition has workstream routing context and specialized deliberation/recovery
status responders, but no operating-attention consumer or general per-turn status
footer. This slice does not introduce one. A future adapter can invoke the same
application attention command; no Discord-specific health authority is created.

The [predeclared journey](../../../roadmap/open-collaboration-platform/core-health-signal-slice-1.md)
requires seven days and at least 20 installed turns on each of Mac and WSL.
Source wiring and fixture evidence earn at most `wired`; installed parity and
the felt outcome remain unknown without that evidence. Focused tests cover empty
healthy output, unknown evidence, ownership, byte bounds, the prompt boundary
and host-neutral projection. They are written but not run in this task.
