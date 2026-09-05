# Local package contract

`lervo-capability.json` defines one immutable `skill`, `mcp_server`, `provider_plugin`, or `bundle` package. It binds an ID, semantic version, content hash, provenance, provider and platform compatibility, required role permissions, exact dependencies, kind-specific entrypoint, explicit activation, and secret exclusion. Kind and entrypoint must agree.

## Discovery and selection

An optional `discovery` block binds a display name, summary, bounded keywords and natural-language intents, and an explicit `autoSelect` decision. Managed runs score only this verified metadata:

- Exact intent phrases and token matches have deterministic weights.
- Candidates below the threshold are ignored; ties are stably ordered.
- At most eight packages are selected.

Recommendation remains observable when the caller supplies an explicit package coordinate, but that coordinate determines selection and bypasses semantic capability grounding. Role defaults also take precedence over automatic selection. Recommendation never proves selection, loading, or use.

## Storage and installation

Project packages live lazily under `.lervo/capabilities/packages/`; user packages live under `~/.lervo/capabilities/packages/`. Local validation, installation, listing, and resolution work without a Hub.

Installation is plan-first; apply requires the current plan hash. Existing coordinates are idempotent for identical content and conflict for different content.

## Reader and secret constraints

Readers accept at most 256 regular files and 16 MiB, follow no symlinks, reject path escape and read races, and exclude hidden or conventional credential, private-key, and secret filenames. Only native Codex and Claude plugin manifests may be hidden package files.

MCP manifests contain credential names, configuration references, and runtime-descriptor references, never credential values.
