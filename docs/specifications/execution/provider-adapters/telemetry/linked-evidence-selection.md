# Linked-Evidence Selection Boundary

Historical: [ADR-0528](../../../../decisions/search/activation/0528-remove-the-linked-evidence-canary-and-shadow.md) removed the canary that used this boundary. This specification preserves its former contract for historical references; it does not describe an active selection path.

The default-off managed linked-evidence canary used the adapter boundary for at most one isolated selection turn. Core owned eligibility, the relational v17 protocol, exact token validation, source reload, E1–E4 separation, and bounded storage. Each adapter owned only its native schema carrier, context delivery, events, usage normalization, result binding, and stop behavior. Disabled and coordinate-ineligible runs created no selection adapter.

The former ordinary linked-projection path selected bounded context before creating the ordinary Codex or Claude task adapter, without a selection adapter, provider-specific branch, API key, or user setting. This is historical behavior, not a current managed-run guarantee. ADR-0528 records that ADR-0302 retired the ordinary linked-evidence default and requires any future relation or linked-context mechanism to enter through the search-engine port and a paired comparison.

After adapter start, before candidate injection or a model turn, the canary required the session to report `toolCalls`, `commandExecution`, and `fileChanges` as `unsupported`. A mismatch recorded a bounded selection failure and stopped the session with zero selection turns. An accepted turn was never retried, repaired, or replaced.

In the historical provider contract, Claude's explicit empty tool list reported `toolCalls` unsupported. Codex app-server 0.150.1 had no thread- or turn-level no-tool control, so an app-server read-only session remained ineligible even with a read-only filesystem sandbox and denied approvals. Sandbox and approval settings must never prove tools or commands unavailable.
