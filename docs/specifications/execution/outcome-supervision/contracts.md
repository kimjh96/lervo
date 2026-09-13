# Outcome supervision contracts

Status: `designed; implementation required`
As of: 2026-09-11

Part of [outcome supervision](../outcome-supervision.md). Envelope version 3 readers support the payload version 1 contracts below. No existing writer or protocol implicitly gains these capabilities.

- [Operating mandate and admission](contracts/admission.md): authority, exact plans, responsibilities, and review.
- [Persistence and versioned events](contracts/events.md): canonical records, event payloads, and idempotency.
- [Derived status](contracts/status.md): report fields, status evidence, and failure boundaries.
- [Wakeups and recovery](contracts/recovery.md): durable routing, deadlines, concurrency, and limits.
- [Boundaries, evidence, and compatibility](contracts/boundaries.md): component ownership, observations, and activation.
