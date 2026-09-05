# GLA17: Managed execution resource budget policy

GLA17 preserves total-token admission and adds independent input, cached-input, output, reasoning-output, and per-run managed-stage duration limits. Exact resource and stage projections feed one controller-owned assessment; the CLI and operating client only parse or render it. Duration uses the maximum matching run, never summed cross-profile or concurrent elapsed time.

Configured limits fail closed before the next attempt and after an otherwise accepted provider run but before assignment completion. Partial, unavailable, invalid, absent, or ambiguous evidence remains unknown. Direct-terminal whole-task usage, monetary cost, future reservation, and in-flight preemption remain unsupported.

## Acceptance

Focused tests must cover:

- Legacy total-token compatibility, dimension separation, and exact resource and stage coordinates.
- Inclusive thresholds, no cross-profile duration addition, and missing observation failure.
- Controller-owned operating projection, CLI parsing and exit status, and post-run assignment rejection.

Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, and task-base release completion must pass with reviewed minor release intent.
