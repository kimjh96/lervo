# ADR-0159: Atomic Hub Bearer-Credential Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Inline startup-only tokens mixed secrets with reviewed config and required Hub downtime. Partial credential updates would break snapshot consistency, and invalid candidates must not erase working authentication.

## Decision

Hub accepts exactly one of legacy inline credentials or recommended credentialsFile. The owner-only UTF-8 file is at most 1 MiB and contains only schemaVersion 1 and credentials; its path resolves from Hub config. Startup validates every token, principal, duplicate, permission, and at most 256 project scopes before listening.

ReloadableBearerAuthenticator builds a complete immutable candidate before one reference swap. Each in-flight request retains either the old or new snapshot. At this decision SIGHUP reloaded credentials; ADR-0162 later expands it to credentials plus TLS/signing. reloadCredentials remains credential-only; inline reload is a no-op.

Read/JSON/contract failure reports only credential_reload_failed and preserves current state. Token issuance/distribution/revocation, automatic expiry, secret managers, and other key reload were not included here. Operators rotate by adding an overlapping snapshot, switching Node, then removing the old token.

Tokens exist only in the owner-only file and authenticator memory. No output, event, Hub/policy/replay database, or receipt contains tokens, paths, principal lists, or causes. Reload proves no sync, command, or content use and adds no event/scheduler.

## Consequences

Fixtures verify safe external files, rejection of public/corrupt sources, live old-to-new authentication inversion, invalid-candidate rollback, coalesced reload promises, nonterminating SIGHUP, and fixed failure callbacks.
