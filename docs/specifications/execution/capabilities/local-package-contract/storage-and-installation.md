# Storage and installation

Project packages live lazily under `.lervo/capabilities/packages/`; user packages live under `~/.lervo/capabilities/packages/`. Local validation, installation, listing, and resolution work without a Hub.

Installation is plan-first; apply requires the current plan hash. Existing coordinates are idempotent for identical content and conflict for different content.
