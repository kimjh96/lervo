# ADR-0082: Machine-readable trace capabilities

Status: `accepted`; ADR-0084 updates current default to `page`
Decision date: 2026-08-20

## Decision

- `lervo trace --capabilities` outputs only `TraceCapabilitiesReport` v1 JSON, without opening a project or storage or writing anything.
- Allow redundant `--json`; reject combinations with run, root, full, page, filter, or cursor options before opening storage.
- Report the default and supported modes, explicitness, report kinds and schema versions, filter and cursor support, and actual page, full, and cursor limits from diagnostics constants.
- Deprecations contain only the code, source and replacement modes, target version, and next default—not human warning text.
- Schemas and types live in `@lervo/schemas`, the generator and reader in diagnostics, and option and stdout composition in the CLI. Semantic validation checks references, uniqueness, and bounds.
- Unsupported or invalid reports use fixed, source-free codes and add no events or state.

## Consequences

Automation can discover the actual trace contracts without parsing help text or stderr.
