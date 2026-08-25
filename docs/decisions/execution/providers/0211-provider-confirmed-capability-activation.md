# ADR-0211: Provider-confirmed capability activation

- Status: accepted
- Decision date: 2026-08-25

## Context

Capability package resolution and locking did not make MCP servers or provider plugins available inside a managed Codex or Claude session. Treating selection or configuration as activation would overstate evidence, while allowing unverified startup would let a managed turn run with a missing or different capability.

## Decision

### Provider-neutral activation request

Every MCP package includes a hashed `lervo-mcp.json`. Its v1 descriptor selects either a bounded stdio process or HTTPS transport; loopback HTTP is also allowed for local development. Stdio uses an executable name plus an entrypoint contained in the immutable package, never a shell command string. HTTP URLs contain no credentials. The outer manifest declares every credential environment-variable name, and HTTP bearer configuration must match that declaration exactly.

Provider-plugin packages contain the native `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json`. The native name must be present and its version must equal the outer package version. The resolver turns verified package bytes into exact, provider-neutral activation requests containing package coordinates and runtime bindings. Local paths and credential names may cross the in-process adapter boundary; neither is event data.

### Managed ordering and provider adapters

The managed sequence is `resolve -> start provider with exact configuration -> inject controlled context -> confirm activation -> attach write bridge -> start turn`. Activation has a 30-second orchestration deadline and occurs once per session. A missing adapter implementation, missing credential, provider mismatch, disconnected MCP server, plugin load error, receipt mismatch, duplicate receipt, or timeout fails with `capability_activation_failed` before the task turn.

The Codex adapter supplies an isolated thread `mcp_servers` override and selected capability roots, then queries thread-scoped MCP server status. Acceptance of the selected immutable capability root is the Codex plugin-load confirmation available at thread creation. The Claude adapter uses empty setting sources, strict explicit MCP configuration, local plugins with plugin MCP discovery disabled, and no Agent or Task tool. After controlled context starts the SDK query, it requires connected MCP status and an error-free plugin reload containing the exact path and version.

Provider behavior remains inside adapters. Both adapters pass the same activation receipt contract and provider parity tests. Root agents, concurrently scheduled agents, and subagents use the same managed-run boundary; their existing exact capability-package bindings prevent expansion or drift.

### Evidence and privacy

Only a validated provider receipt creates `capability.activated`. Required fields are package ID, kind, version, content hash, adapter ID, provider-session ID, evidence (`mcp_connected` or `plugin_loaded`), activation digest, actor/provider, and confirmation time. Project, run, and session coordinates remain in the event envelope. The payload excludes package paths, commands, arguments, URLs, configuration, credential names and values, plugin contents, tool inventories, and provider errors.

Activation proves only the provider-reported connection or load state before the turn. It does not prove that the model saw, invoked, relied on, or used the capability. `resolved`, `activated`, `invoked`, and `used` remain distinct claims. Failed confirmation emits no activation event; the ordinary privacy-bounded `run.failed` digest records the failure class.

## Consequences

Locally installed MCP servers and provider plugins now work through `lervo run --capability` without a Hub or provider-global installation. Configuration remains reproducible and package-bound, secrets remain runtime-only, and managed execution cannot silently continue with a missing capability. Future providers implement the same request and receipt contracts without changing core orchestration.
