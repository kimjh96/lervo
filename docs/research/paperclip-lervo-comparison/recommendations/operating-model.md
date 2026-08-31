# Recommended operating model

## Read-only operating board

Project canonical state into a deterministic, read-only view containing:

- the current objective and next actions;
- agents, roles, assignments, dependencies, and parent relationships;
- lease generation, expiry, and expected paths;
- blockers, pending approvals, and verification status;
- managed or unmanaged execution status; and
- selected, loaded, injected, referenced, and unsupported-use evidence.

The board must not become a second authority for repository state.

## Usage ledger and budget gates

Record adapter-verified usage as `observed`, price-table calculations as `estimated`, and missing provider data as `unknown`. Aggregate usage by project, workstream, agent, assignment, provider, and model. Add warnings and hard stops only after measuring telemetry coverage and accuracy.

## Local routines and triggers

A routine must materialize an exact assignment template, not execute an arbitrary prompt. Bind the role version, capability hash, expected paths, verification, approval requirements, and concurrency policy. Begin with `skip_if_active`, `coalesce_if_active`, and bounded enqueue semantics.

## Objectives and interaction threads

Add objective and parent-assignment coordinates without copying goal prose into runtime events. Store progress, blocker, review, decision-request, and handoff bodies as bounded artifacts. Events contain only identifiers, hashes, privacy classification, and state transitions.

Route mentions through existing workforce, handoff, and deliberation contracts rather than creating another collaboration engine.

## Capability catalog

Expose provenance, compatibility, permission changes, dependency changes, drift, and lock differences before adding social ranking features.
