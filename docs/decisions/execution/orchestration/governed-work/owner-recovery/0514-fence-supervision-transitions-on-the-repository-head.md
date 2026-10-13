# ADR-0514: Fence supervision transitions on the repository event head observed before the source read

Status: `accepted`
Decision date: 2026-10-13

## Context

Since 2026-09-30, `SupervisionTaskSource` reads a workstream-scoped history. It holds supervision control metadata plus the runs causally linked to the workstream. Eleven effect paths still fenced their commit by comparing the repository's latest event with the last event of that scoped list:

- workspace preparation and recovery;
- owner attention, artifact review and goal completion;
- assignment completion, cancellation and handoff;
- request binding, result delivery and owner reasoning admission.

The two values match only when the newest repository event is in scope. Background knowledge maintenance and other runs routinely append events outside the workstream's scope. Each fence then failed before committing, although nothing it depended on had changed.

After ADR-0513 was deployed on 2026-10-13, axli's next workspace preparation was recorded uncertain ("The workspace preparation event source changed"). Its recovery then failed every cycle with "The workspace recovery source changed before receipt commit".

## Decision

`SupervisionTaskSource.read()` returns `headEventHash`: the repository's latest event hash, observed before the scoped history is read. Every transition fence that compared the scoped list's last event now compares the current head with that hash. A transition commits only if no event at all was appended since its source was read. This is the same guarantee the full-history reader gave before scoping.

## Consequences

An out-of-scope event that precedes the read no longer blocks a transition. An event appended after the read, in or out of scope, still fails the fence, and the next cycle re-reads and retries.

## Verification

The owner-reasoning workspace test adds two scenarios with another run's completion as the repository head. A lost preparation receipt with that head reproduced axli's recovery error before this change and is confirmed after it. The other eight scenarios pass unchanged.
