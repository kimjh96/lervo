---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.orchestration
---

# ADR-0378: Install authenticated live webhook triggers

Status: `superseded`
Decision date: 2026-09-07

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Reviewed local routines and direct-message handoff existed, but no installed external receiver could authenticate an event and invoke governed work. Payload content as assignment authority, an in-memory replay set, or retries after uncertain writes would violate existing authority and recovery contracts.

## Decision

Install a provider-neutral live-trigger contract, one HMAC-SHA256 webhook adapter, an atomic SQLite reservation store, and a CLI loopback server. User-owned authorization fixes the project, active workstream, source, credential, event types, validity, cumulative trigger budget, and routine template. Authenticate and hash external payload bytes; never interpret them as instructions.

Reserve each source-event-key hash before assignment materialization. Persist a monotonic authorization counter separately from prunable completion records. Exact replay returns current completion; changed content conflicts; concurrent unfinished work fails closed. Materialization failure requires exact replay from `recovery_required`. Process-loss uncertainty requires an explicit age-bounded recovery operation before replay.

Authenticated routine requests require the in-process admission plan. The public routine-file command accepts manual triggers only and cannot forge live authority. The webhook creates assignments through existing deterministic routine and workforce transactions and never starts providers.

## Consequences

The installed CLI proves one real authenticated external source can trigger governed work without a Hub. Cron, platform-specific API, approval-resolution, assignment-wakeup, service supervision, unattended claiming, and dynamic graphs remain extension work. New adapters must implement the shared descriptor, privacy, authentication, idempotency, authority, budget, and recovery contracts rather than modify core execution.

No new event is added. Private reservation evidence excludes raw bodies, signatures, secrets, native identifiers, prose, paths, and unrestricted errors. Existing assignment events identify `authenticated_live` provenance without claiming execution or provider use.

## Verification

- Contract, adapter, SQLite, routine-authority, and CLI HTTP tests cover authentication, privacy, replay, conflicts, budgets, recovery, retention, and forgery rejection.
- The packed CLI consumer starts the installed loopback server, sends a signed request, observes one assignment, and proves exact replay is current.
- Repository quality, documentation, migration, knowledge lint, completion, and terminal-attention gates remain required.

## References

- Authenticated live trigger specification, removed by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)
- Authenticated live trigger roadmap outcome, removed by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)
