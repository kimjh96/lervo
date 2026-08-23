# ADR-0161: Atomic Node Bearer-Token Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub credentials could overlap, but Node copied one startup token into every transport, forcing both polling loops and providers to stop for rotation.

## Decision

Startup and reload share the owner-only bounded loader: 32–4096 visible ASCII characters with one optional LF or CRLF. ReloadableNodeBearerToken replaces its reference only with a fully validated string; any read, permission, UTF-8, or format failure preserves the current token.

Each sync, policy, lease, acknowledgement, or artifact HTTP operation snapshots the token once into an immutable transport. Different requests may see different complete snapshots, never partial content.

The credential-only API reloads only the token file. ADR-0163 expands process SIGHUP to prevalidate token plus trust material atomically without stopping loops, providers, or stores. Credential-only failure reports token_reload_failed and retains runtime; success creates no output/event/receipt/state.

Safe rotation adds old+new to Hub, atomically replaces the owner-only Node file, signals reload, verifies the new connection, then removes the old Hub credential.

Tokens remain only in file and memory. Errors expose no token, path, Hub coordinates, or cause. Reload proves no connection, command, provider, or content use.

## Consequences

Fixtures verify live token replacement, invalid-candidate rollback, per-request snapshotting across policy/command, coalesced reload promises, nontermination on failure, and the ADR-0163 full-material signal boundary.
