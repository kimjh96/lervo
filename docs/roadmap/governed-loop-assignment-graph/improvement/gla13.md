# GLA13: Explicit local improvement observation host

The installed CLI packages the private local observation adapter while preserving per-command authority. `knowledge pattern effect collect --local-events` reads a version-1 bounded request and emits:

- The adapter descriptor and exact request coordinates.
- Both supported observations and explicit unavailable results.
- Unestablished attribution.
- A declaration that no canonical state changed.

Without `--local-events`, collection fails before event-storage access. The same flag supplies the local verifier to existing register and observe apply operations. It replaces neither the exact plan ID nor `--write`; apply re-observes the reviewed window before CAS or event mutation.

Adapter composition, collection, rendering, command parsing, canonical routing, and storage remain separate. GLA13 adds no metric, event, state store, background observer, provider authority, automatic promotion, rollback, or model-learning claim.

## Acceptance

Focused tests must cover:

- Versioned collection and explicit authority.
- Exact descriptor and two-metric output; unavailable propagation.
- No-mutation reporting and text rendering.
- Default no-authority behavior.
- Full baseline-to-promotion-to-treatment comparison through the installed host path.
- Packed CLI inclusion.

Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.
