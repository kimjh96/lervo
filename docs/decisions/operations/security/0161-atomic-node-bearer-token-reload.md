# ADR-0161: Atomic Node Bearer-Token Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub credentials could overlap during rotation, but Node copied one startup token into every transport, requiring polling loops and providers to stop whenever the token changed.

## Decision

Startup and reload use the same bounded, owner-only loader. A token must contain 32–4096 visible ASCII characters followed by at most one LF or CRLF. `ReloadableNodeBearerToken` replaces its reference only after fully validating the new string. Any read, permission, UTF-8, or format failure preserves the current token.

Each sync, policy, lease, acknowledgement, or artifact HTTP operation snapshots the token once into an immutable transport. Different requests may use different complete snapshots, but no request can observe partial content.

The credential-only API reloads only the token file. ADR-0163 extends process SIGHUP to prevalidate the token and trust material atomically without stopping loops, providers, or stores. Credential-only failure reports `token_reload_failed` and retains the running state. Success creates no output, event, receipt, or state.

Safe rotation adds both old and new credentials to Hub, atomically replaces the owner-only Node token file, signals reload, verifies a connection using the new token, and then removes the old Hub credential.

Tokens remain only in the file and memory. Errors reveal no token, path, Hub coordinates, or cause. A successful reload proves no connection, command, provider, or content use.

## Consequences

Fixtures verify live replacement, rollback after an invalid candidate, per-request snapshotting across policy and command operations, coalesced reload promises, continued execution after failure, and the ADR-0163 full-material signal boundary.
