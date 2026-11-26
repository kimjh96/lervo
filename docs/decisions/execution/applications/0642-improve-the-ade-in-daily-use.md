# ADR-0642: Improve the ADE in daily use

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0637](0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md) (the S2 steps no longer wait for a day of use), [ADR-0632](0632-build-the-ade-as-the-platform-where-the-core-works.md) (the day of use becomes daily use)
Related: [ADR-0613](0613-host-provider-clis-in-a-first-party-development-environment.md)

## Context

On 2026-11-25 the owner set the order for leaving Orca: the daily conversation first, then a day on which the owner would use the ADE instead of Orca, with what they hit fixed before Orca retires. Agent identity, rooms, and coordination (S2c, S2g, S2h) waited until after that day, and ADR-0637 kept that order.

By 2026-11-26 the ADE had stopping a turn, tool runs, Lervo's lines in each turn, images, files, compactions, queued replies, and projects with a first run (ADE 0.9.0). On that day the owner decided against a one-day trial: they work in Lervo from now on and improve it from what they hit.

## Decision

- The owner uses the ADE for daily work from 2026-11-26. There is no day-of-use milestone.
- What the owner hits is fixed as it comes up and released in batches, as every ADE change is. A fix for something that blocks work goes first.
- S2c, S2g, and S2h no longer wait. They run in ADR-0637's order alongside the fixes, each with its interface designed and shown first.
- Orca retires once the owner no longer opens it. Its hooks are removed then, and the projects under `~/orca` move to the projects location (ADE roadmap, "Leaving `~/orca`").

## State, events, privacy, and failure meaning

None. This decision changes order and acceptance only: no command, event, state, or stored field.

## Consequences

- The ADE roadmap's "The day of use" step becomes "Daily use", which is done when the owner no longer opens Orca.
- Problems surface over days of real work rather than in one day. The batch release rule keeps fixes from releasing one by one.
