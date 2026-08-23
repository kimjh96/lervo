# ADR-0082: Machine-readable trace capabilities

Status: `accepted`; ADR-0084 updates current default to `page`
Decision date: 2026-08-20

## Decision

- `lervo trace --capabilities` outputs only `TraceCapabilitiesReport` v1 JSON without opening project/storage or writing anything.
- Allow redundant `--json`; reject run/root/full/page/filter/cursor combinations before storage.
- Report default/supported modes, explicitness, report kinds/schema versions, filter/cursor support, and actual page/full/cursor limits from diagnostics constants.
- Deprecations contain only code, source/replacement mode, target version, and next default—not human warning text.
- Schemas/types live in `@lervo/schemas`, generator/reader in diagnostics, option/stdout composition in CLI. Semantic validation checks references, uniqueness, and bounds.
- Unsupported/invalid reports use fixed source-free codes and add no events/state.

## Consequences

Automation discovers actual trace contracts without parsing help or stderr.
