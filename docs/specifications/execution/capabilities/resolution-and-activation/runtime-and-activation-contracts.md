# Runtime and activation contracts

Every MCP package carries a hashed `lervo-mcp.json` selecting bounded stdio or HTTPS/loopback HTTP. Stdio entrypoints remain inside the immutable package and never use a shell string. Credentials are named in the manifest and read from the process environment only when the provider session starts.

Provider plugins carry the native `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json` with an exactly matching version.

Codex and Claude receive exact activation requests through their adapters. After controlled context injection and before the task turn, each adapter confirms connected MCP status and provider-plugin loading and returns one exact receipt per request.

Missing support, configuration, credentials, connection, plugin load, exact receipt, or deadline fails closed with `capability_activation_failed`. Successful confirmation emits `capability.activated`, proving connection or load only, never invocation or use.
