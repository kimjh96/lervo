# Capability registration and activation

Agent state may contain exact capability package IDs, kinds, versions, content hashes, and project or user source scopes. `capabilityHash` binds these coordinates and role-permission decisions. It excludes package bodies, publisher metadata, local paths, MCP configuration values, credentials, and Hub tokens.

Registration failure records neither a hired agent nor package authority. Capability installation and Hub publication return operation receipts, add no execution event, and prove no loading, activation, invocation, or use.

Managed `capability.activated` is emitted only after the provider adapter returns a valid exact receipt. Its envelope binds project, run, session, provider actor, and confirmation time. Its payload contains capability ID and kind, version and content hash, adapter and provider-session IDs, evidence (`mcp_connected` or `plugin_loaded`), and a privacy-bounded activation digest.

The activation event excludes local paths, commands, arguments, URLs, configuration, credentials and credential names, plugin content, tool inventories, and raw errors. Confirmation failure or timeout emits no activation event, blocks the task turn with `capability_activation_failed`, and appears only as the bounded `run.failed` diagnostic digest. Activation proves connection or load before the turn, not invocation or use.
