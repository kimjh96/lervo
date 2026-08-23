# ADR-0083: Trace default-transition compatibility fixture

Status: `accepted`; ADR-0084 switched fixture to 0.1.0 expectations
Decision date: 2026-08-20

## Decision

A test-only project creates one run with 51 fixed allowlisted events: one above default page 50 and below full 1,000. The 0.0.x fixture jointly checked implicit-full capabilities/deprecation, valid 51-event implicit full with one source-free warning, identical quiet `--full`, valid `50 + 1` cursor pages without gaps/duplicates, and absence of whole-run status on pages.

Any setup/reader/warning/stdout/cursor mismatch fails the fixture. It changes no runtime mode/version/schema/user project. The 0.1.0 transition had to update default call, capabilities, explicit-full regression, help, and migration docs together without dual defaults.

## Consequences

The old/new consumer boundary is reproducible and release changes cannot silently desynchronize CLI from capabilities.
