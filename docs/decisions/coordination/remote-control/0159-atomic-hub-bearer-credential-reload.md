# ADR-0159: Atomic Hub Bearer-Credential Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Inline, startup-only tokens mixed secrets with reviewed configuration and required Hub downtime. Partial credential updates would violate snapshot consistency, and invalid candidates must not erase working authentication.

## Decision

The Hub accepts exactly one of legacy inline credentials or the recommended `credentialsFile`. Its path resolves relative to the Hub config. The owner-only UTF-8 file is limited to 1 MiB and may contain only `schemaVersion` 1 and `credentials`. Before listening, startup validates every token, principal, duplicate, permission, and the limit of 256 project scopes.

`ReloadableBearerAuthenticator` builds and validates a complete immutable candidate before replacing one reference. Each in-flight request retains either the old or new snapshot.

At this decision, SIGHUP reloaded credentials. ADR-0162 later expands SIGHUP to credentials, TLS, and signing material. `reloadCredentials` remains credential-only; reloading inline credentials is a no-op.

Read, JSON, or contract failures report only `credential_reload_failed` and preserve the current snapshot. Token issuance, distribution, revocation, automatic expiry, secret managers, and other key reloads are excluded. Operators rotate credentials by adding an overlapping snapshot, switching the Node, and then removing the old token.

Tokens exist only in the owner-only file and authenticator memory. No output, event, Hub/policy/replay database, or receipt contains tokens, paths, principal lists, or failure causes. Reload proves no sync, command, or content use and adds no event or scheduler.

## Consequences

Fixtures verify safe external files, rejection of public or corrupt sources, live old-to-new authentication inversion, invalid-candidate rollback, coalesced reload promises, nonterminating SIGHUP, and fixed failure callbacks.
