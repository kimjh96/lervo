# Resolution and activation

Resolution applies project-before-user precedence, semantic versions, provider and platform compatibility, role permissions, exact transitive dependencies, and bounded acyclic bundles. `.lervo/capabilities.lock` is rebuildable state containing only ID, kind, version, content hash, local source scope, and `resolved` status.

`resolved` does not mean `loaded`, `injected`, `activated`, `invoked`, or `used`. Skill entrypoints must also pass the independently valid skill manifest, resolver, and skill lock.

## Managed execution evidence

- `capability.recommended` records the query digest, score, and reason codes.
- `capability.selected` records explicit, role-default, natural-language, or dependency selection.
- `capability.loaded` proves current package validation.
- `capability.activated` proves only provider connection or plugin load.

For a skill, Lervo reloads and rehashes `SKILL.md`, places its exact verified instructions in the provider turn, emits `skill.invoked`, and emits `skill.completed` only after storing a result artifact.

For MCP, an exact normalized `mcp__<server>__*` provider tool signal bound to confirmed activation emits privacy-bounded `capability.invoked` or `capability.completed` alongside `tool.called`.

Plugins receive no invocation claim unless a future adapter supplies an equally exact binding. These events prove observable orchestration, not model attention, understanding, or semantic reliance.

## Runtime and activation contracts

Every MCP package carries a hashed `lervo-mcp.json` selecting bounded stdio or HTTPS/loopback HTTP. Stdio entrypoints remain inside the immutable package and never use a shell string. Credentials are named in the manifest and read from the process environment only when the provider session starts.

Provider plugins carry the native `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json` with an exactly matching version.

Codex and Claude receive exact activation requests through their adapters. After controlled context injection and before the task turn, each adapter confirms connected MCP status and provider-plugin loading and returns one exact receipt per request.

Missing support, configuration, credentials, connection, plugin load, exact receipt, or deadline fails closed with `capability_activation_failed`. Successful confirmation emits `capability.activated`, proving connection or load only, never invocation or use.

## Workforce authority

Roles may list `defaultCapabilityPackages`. Hired agents bind exact package versions and hashes into their capability hash. Subagents inherit the parent set and may narrow but cannot expand it. Before provider creation, workforce execution re-resolves requested packages and rejects drift or authority expansion.
