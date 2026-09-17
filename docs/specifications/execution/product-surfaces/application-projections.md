# Application projections

These rebuildable version-1 application results use existing authorities and observations without adding a canonical store or event type. Add schemas and common fixtures before exposing a route.

## Projection contracts

- [Activity](application-projections/activity.md): required fields, action classes, privacy exclusions, and evidence failures for `ProductActivityPageV1`.
- [Unified search](application-projections/unified-search.md): required fields, authorized corpora, stage failures, and telemetry exclusions for `ProductUnifiedSearchResultV1`.
- [Observability report](application-projections/observability-report.md): required fields, completeness rules, resource groups, and cache entries for `SurfaceObservabilityReportV1`. Privacy and failure meanings follow [surface observability](observability.md).
- [Deliberation](application-projections/deliberation.md): origin, participant, artifact, verification, resource, publication, and delivery fields for `ProductDeliberationViewV1`.
- [Commands and subscriptions](application-projections/commands-and-subscriptions.md): typed steering commands, bounded hints, and cursor-based replay.
