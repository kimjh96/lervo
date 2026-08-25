# Capability package supply chain

Status: `active`
As of: 2026-08-25

## Local package contract

`lervo-capability.json` defines one immutable `skill`, `mcp_server`, `provider_plugin`, or `bundle` package. It binds an ID, semantic version, content hash, provenance, provider and platform compatibility, required role permissions, exact dependencies, a kind-specific entrypoint, explicit activation, and secret exclusion. Kind and entrypoint must agree.

An optional `discovery` block binds a display name, summary, bounded keywords and natural-language intents, and an explicit `autoSelect` decision. Managed runs score only this verified metadata. Exact intent phrases and token matches have deterministic weights. Candidates below the threshold are ignored, ties are stably ordered, and at most eight packages are selected. Explicit requests and role defaults take precedence. Recommendation never proves loading or use.

Project packages live lazily under `.lervo/capabilities/packages/`; user packages live under `~/.lervo/capabilities/packages/`. Local validation, installation, listing, and resolution work without a Hub. Installation is plan-first; apply requires the current plan hash. Existing coordinates are idempotent for identical content and conflict for different content.

Readers accept at most 256 regular files and 16 MiB, follow no symlinks, reject path escape and read races, and exclude hidden or conventional credential, private-key, and secret filenames. Only native Codex and Claude plugin manifests may be hidden package files. MCP manifests contain credential names, configuration references, and runtime-descriptor references, never credential values.

## Resolution and activation

Resolution applies project-before-user precedence, semantic versions, provider and platform compatibility, role permissions, exact transitive dependencies, and bounded acyclic bundles. `.lervo/capabilities.lock` is rebuildable state containing only ID, kind, version, content hash, local source scope, and `resolved` status.

`resolved` does not mean `loaded`, `injected`, `activated`, `invoked`, or `used`. Skill entrypoints must also pass the independently valid skill manifest, resolver, and skill lock.

Managed evidence separates these stages:

- `capability.recommended` records the query digest, score, and reason codes.
- `capability.selected` records explicit, role-default, natural-language, or dependency selection.
- `capability.loaded` proves current package validation.
- `capability.activated` proves only provider connection or plugin load.

For a skill, Lervo reloads and rehashes `SKILL.md`, places its exact verified instructions in the provider turn, emits `skill.invoked`, and emits `skill.completed` only after storing a result artifact. For MCP, an exact normalized `mcp__<server>__*` provider tool signal bound to confirmed activation emits privacy-bounded `capability.invoked` or `capability.completed` alongside `tool.called`. Plugins receive no invocation claim unless a future adapter supplies an equally exact binding. These events prove observable orchestration, not model attention, understanding, or semantic reliance.

Every MCP package carries a hashed `lervo-mcp.json` selecting bounded stdio or HTTPS/loopback HTTP. Stdio entrypoints remain inside the immutable package and never use a shell string. Credentials are named in the manifest and read from the process environment only when the provider session starts. Provider plugins carry the native `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json` with an exactly matching version.

Codex and Claude receive exact activation requests through their adapters. After controlled context injection and before the task turn, each adapter confirms connected MCP status and provider-plugin loading and returns one exact receipt per request. Missing support, configuration, credentials, connection, plugin load, exact receipt, or deadline fails closed with `capability_activation_failed`. Successful confirmation emits `capability.activated`, proving connection or load only, never invocation or use.

Roles may list `defaultCapabilityPackages`. Hired agents bind exact package versions and hashes into their capability hash. Subagents inherit the parent set and may narrow but cannot expand it. Before provider creation, workforce execution re-resolves requested packages and rejects drift or authority expansion.

## Repository migration

`lervo migrate capabilities` creates a read-only, content-bound plan. Apply promotes independently valid `.agents/skills/*` packages into immutable project capability packages without changing their content hash. A standard Agent Skill containing only `SKILL.md` receives a synthesized `1.0.0`, unsigned/untrusted, all-role compatibility contract inside the installed package; its source directory remains byte-for-byte unchanged. `lervo init` performs this safe promotion automatically.

Existing Codex and Claude MCP or plugin configuration is observed as `unmanaged_provider_owned`; Lervo never copies possible credentials or silently translates provider semantics. MCP and plugin behavior enters managed execution only through a validated secret-free capability package and adapter activation receipt.

## Optional Hub distribution

Packages are never uploaded automatically. `capability publish` and `capability pull` create content-bound plans and require `--apply --approval <plan-hash>`. Bearer values come from `LERVO_HUB_TOKEN` or another explicitly named environment variable and never enter plans, receipts, manifests, locks, records, or errors.

Project publication binds an authorized destination and project. Public publication is separately explicit. `capability.publish` and `capability.read` are separate permissions. Hub records store an immutable package envelope, scope, publisher principal ID, publication time, and a structured header containing content class, capability kind, manifest schema version, file count, total bytes, and secret exclusion. Filesystem registries shard capability IDs by a deterministic two-hex digest. Same-content retries are idempotent; different content at one coordinate conflicts. Hub failure never invalidates local packages.

## Evidence and privacy

Package bytes are canonical local state; the lock is derived. Agent state retains exact package coordinates but excludes package bodies, publisher metadata, local paths, configuration values, credentials, and tokens. Install, publish, and pull receipts prove only those operations, not provider execution or package use.

The [events and privacy specification](events-and-privacy.md) defines workforce state disclosure. [ADR-0210](../../decisions/execution/orchestration/0210-local-first-capability-package-supply-chain.md) records the supply chain, and [ADR-0211](../../decisions/execution/providers/0211-provider-confirmed-capability-activation.md) records provider activation.
