# ADR-0083: Trace default-transition compatibility fixture

Status: `accepted`; ADR-0084 switched fixture to 0.1.0 expectations
Decision date: 2026-08-20

## Decision

A test-only project creates one run with 51 fixed, allowlisted events: one more than the default page size of 50 and fewer than the full limit of 1,000.

The 0.0.x fixture jointly verified implicit-full capabilities and deprecation behavior, a valid 51-event implicit full report with one source-free warning, an identical and quiet `--full` report, valid `50 + 1` cursor pages without gaps or duplicates, and no whole-run status on pages.

Any setup, reader, warning, stdout, or cursor mismatch fails the fixture. The fixture changes no runtime mode, version, schema, or user project. The 0.1.0 transition had to update the default call, capabilities, explicit-full regression, help, and migration documentation together, without dual defaults.

## Consequences

The old-to-new consumer boundary is reproducible, and release changes cannot silently desynchronize the CLI from its capabilities report.
