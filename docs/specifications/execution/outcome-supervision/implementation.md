# Outcome supervision implementation boundary

Status: `local native execution, acceptance, recovery, research and scoped handoffs implemented; installed acceptance and activation required`
As of: 2026-09-12

## Available code

The application contract defines versioned operating mandates, exact action plans, responsibility artifacts, readiness observations, supervision snapshots, and reports. The work controller validates these contracts and evaluates admission, worker readiness, and the next owner action. The orchestrator composes decisions through explicit authority, storage, lease, planning, readiness, and effect ports.

The workforce package provides an event/CAS decision journal and SQLite owner fencing. The shared event reader supports envelope version 3 and its exact supervision payloads. Optional Node startup configuration composes installed mandate authority, native owner reasoning, workforce planning, isolated managed workers, actual readiness probes, independent acceptance, and separate result delivery. Unconfigured startup leaves supervision disabled.

Automatic topology and scoped workforce effects require exact admitted mandate policy; the topology-v2 manual review path remains separate. Research binds explicit repository source policy and real artifact checks to an independent evaluator. Cross-team handoffs use separate owner receipts and read-only peer observations without sharing assignment leases. Stopped failures, rework, attention, cancellation, and publication retain separate evidence and replay boundaries.

Implementation alone installs no mandate, enables no event writer, and activates no production service. Controlled native tests and signed-in local execution are separate from installed Discord acceptance. The [delivery roadmap](../../../roadmap/product-outcome-convergence/execution/outcome-supervision.md) tracks remaining operational proof and activation.

## Implementation contracts

- [Authority and exact effects](implementation/authority.md): installation, policy review, payload verification, and commit fencing.
- [Node composition](implementation/node-composition.md): local authority, durable sessions, task ports, and deployment limits.
- [Responsibility and readiness](implementation/readiness.md): assignment binding and dispatch evidence.
- [Recovery and evidence](implementation/recovery.md): completion, durable decisions, replay, and privacy.
- [Durable storage](implementation/storage.md): canonical decisions, compatible writers, owner fences, bounds, and recovery limits.
- [Verification boundary](implementation/verification.md): tested behavior and unproven integrations.
- [Contracts](contracts.md): proposed-event privacy and compatible-reader requirements.
