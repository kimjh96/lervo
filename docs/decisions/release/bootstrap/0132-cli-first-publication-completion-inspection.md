# ADR-0132: Inspect CLI First-Publication Completion Records

- Status: accepted
- Decision date: 2026-08-21

## Context

Even with a stage-transition receipt, operators otherwise must trace many sources to confirm one approval result and find remaining recorded manual actions. Inspection must not mutate external state or create another durable document.

## Decision

`release:bootstrap:completion-inspect` is read-only and accepts only absolute bundle and transition-receipt paths. The bundle reader revalidates the manifest and six sources. The receipt reader validates the canonical v3 digest and fixed completion semantics.

Pure inspection matches the receipt's stage-reconciliation digest and evidence time to the bundle report. It also matches registry, package, version, tag, artifact integrity, and shasum to the approval attempt. Consumed bootstrap, stage-only Trusted Publisher, and direct-publish prohibition must remain.

`remainingManualActions=[]` applies only to `recorded_first_publication_transition`. The command does not reload bootstrap or publication authorization, reobserve registry, workflow, npm, or GitHub, or verify the receipt signer. Human output explains scope and limits in the configured publication language without exposing paths or digests.

## Consequences

The command summarizes stored provenance on stdout without files, network, external mutation, publication, runtime state, or telemetry. Source races, receipts rebound to other evidence, and reports that elevate external state fail closed.
