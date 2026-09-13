# Linked-Evidence Selection Boundary

The default-off managed linked-evidence canary uses the adapter boundary for at most one isolated selection turn. Core owns eligibility, the relational v17 protocol, exact token validation, source reload, E1–E4 separation, and bounded storage. Each adapter owns only its native schema carrier, context delivery, events, usage normalization, result binding, and stop behavior. Disabled and coordinate-ineligible runs create no selection adapter.

The active ordinary managed-run path does not use this boundary. Core deterministically selects the bounded current linked projection before creating the ordinary Codex or Claude task adapter. This path creates no selection adapter and requires no provider-specific branch, API key, or user setting.

After adapter start, before candidate injection or a model turn, the canary requires the session to report `toolCalls`, `commandExecution`, and `fileChanges` as `unsupported`. A mismatch records a bounded selection failure and stops the session with zero selection turns. An accepted turn is never retried, repaired, or replaced.

Claude's explicit empty tool list reports `toolCalls` unsupported. Codex app-server 0.150.1 has no thread- or turn-level no-tool control, so an app-server read-only session remains ineligible even with a read-only filesystem sandbox and denied approvals. Sandbox and approval settings must never prove tools or commands unavailable.
