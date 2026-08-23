# ADR-0132: Inspect CLI First-Publication Completion Records

- Status: accepted
- Decision date: 2026-08-21

## Context

Even with a stage-transition receipt, operators otherwise must trace many sources to confirm one approval result and identify remaining recorded manual actions. Inspection should not mutate external state or create another durable document.

## Decision

release:bootstrap:completion-inspect is read-only and accepts only absolute bundle and transition-receipt paths. The bundle reader revalidates the manifest and six sources; the receipt reader validates canonical v3 digest and fixed completion semantics.

Pure inspection matches receipt stage-reconciliation digest and evidence time to the bundle report, and registry/package/version/tag plus artifact integrity/shasum to the approval attempt. Consumed bootstrap, stage-only Trusted Publisher, and direct-publish prohibition must remain.

remainingManualActions=[] applies only to recorded_first_publication_transition. The command does not reload bootstrap or publication authorization, reobserve registry/workflow/npm/GitHub, or verify the receipt signer. Human output explains scope and limits in the configured publication language without exposing paths or digests.

## Consequences

Stored provenance is summarized on stdout without files, network, external mutation, publication, runtime state, or telemetry. Source races, receipts rebound to other evidence, and reports that elevate external state fail closed.
