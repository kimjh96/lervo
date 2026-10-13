# ADR-0515: Supersede workspace preparations that stopped before their host effect

Status: `accepted`
Decision date: 2026-10-13

## Context

A workspace preparation first records its workspace (`provisioning`) and then asks Git to create the checkout. If a fence or the host call fails in between, provisioning moves the record to `recovery_required` with `host_effect_uncertain`, even when no checkout was created.

Recovery accepted only a record that had reached `ready`. Supersession accepted only a plan whose record was never created. A record left in between kept its decision uncertain permanently, with no error, event or attention after the first failure.

On 2026-10-13 at 08:42 UTC, axli's preparation `osd_cc51463653690e30` hit a genuine concurrent write from knowledge maintenance at its fence. It left record `wsp_579d571d920c792b5815abcf` at revision 2 with no checkout path, and supervision stopped for more than 30 minutes.

## Decision

- `observeUnhostedWorkspace` recognizes a record whose host effect never happened. All of these must hold:
  - it is at `provisioning` revision 1, at `recovery_required` revision 2 with `host_effect_uncertain`, or at `removed` revision 3 by this plan's withdrawal;
  - its coordination events are only the provision, recovery and withdrawal events;
  - it has no native instance digest and no writer;
  - its checkout path is absent;
  - Git reports the workspace absent.
- Recovery reports such a preparation `not_started`.
- Supersession, under the same source-change or deadline conditions as before, withdraws the record to `removed` with `hostAbsent` and `gitMetadataAbsent` evidence. It then records a version-9 `work.effect_absence` inspection. Version 9 replaces version 3's `workspaceRecordAbsent` and `coordinationEventsAbsent` with `workspaceRecordWithdrawn` and `readyEventAbsent`. The decision journal validates both versions.
- Withdrawal events are deterministic, so an interrupted withdrawal resumes on the next cycle.

## Consequences

A preparation interrupted before its host effect no longer holds the goal. The owner decides again after the plan deadline, or as soon as the source changes. A record that may hold host work still blocks, as before.

## Verification

The owner-reasoning workspace test adds `expired_unhosted`: the Git provision step fails after the record is created. Without this change the cycle stays `uncertain` past the deadline. With it, the cycle reports `changed`, the record is `removed` at revision 3, and no plan remains pending.
