# Managed execution resource budgets v1

Status: `passed`

Observed on: 2026-09-05

## Scope

This evidence covers the installed governed-loop policy for exact managed provider token dimensions and per-run stage durations. It excludes unmanaged direct-provider whole-task usage, prices, invoices, monetary cost, and preemption of in-flight provider calls.

## Verified boundaries

- Existing total-token policy and CLI syntax remain compatible.
- Input, cached-input, output, and reasoning-output thresholds use only normalized provider-reported counters within one provider, scope, source, accounting mode, and descriptor group.
- Duration limits bind provider, resource scope, and managed stage. They assess the maximum exact per-run observation and never sum durations across profiles, concurrent runs, or causal children.
- Missing, partial, unavailable, invalid, and ambiguous evidence remains unknown and produces `budget_observation_unavailable`.
- Inclusive token and duration thresholds produce distinct exhaustion reasons.
- A successful managed run is reprojected before assignment completion. A reached or unobservable configured budget prevents successful finalization.
- The operating client renders controller-owned assessments without owning policy or mutation.
- Resource, stage, budget, CLI parsing, rendering, and post-run finalization responsibilities remain in separate modules.

## Verification

Focused contract, projection, controller, operating-client, CLI, and provider-adapter tests passed. Repository quality, build, full test, documentation lifecycle, knowledge migration and lint, and task-base release completion were run from revision `6a8c53c7813ebd6cbf8193abdf90ca17fc4c361c`.

## Evidence limits

A normalized counter proves only its bound provider report. A stage duration proves elapsed Lervo-observed work for one run and stage. A budget decision proves only comparison with the configured threshold. None proves billed cost, model attention, semantic use, output quality, or a complete unmanaged request total.
