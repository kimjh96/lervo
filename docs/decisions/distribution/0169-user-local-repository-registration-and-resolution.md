# ADR-0169: User-Local Repository Registration and Revalidation

- Status: accepted
- Decision date: 2026-08-22
- Amended by: [ADR-0637](../execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md) (the registry also unregisters a project)

## Context

An always-on Hub may run elsewhere, but managed writes must execute on the repository's filesystem. Conversational absolute paths are not durable selectors, and stale, moved, or reinitialized registrations must not run.

## Decision

`@lervo/repository-registry` is a per-device discovery index, never project or Hub authority. Defaults follow macOS Application Support, Linux XDG state, or Windows LocalAppData. `LERVO_USER_STATE_DIRECTORY` is a safe absolute override.

Only `lervo repository register --root <absolute> --write` mutates the registry. Registration requires a real, nonsymlink root and valid `.lervo/project.yaml`. Atomically store the canonical path, project ID and name, full manifest SHA-256, and time in locked, owner-only `0700`/`0600` state, with a source recheck.

Never auto-select conflicting project/root identities. An identical registration is unchanged; a reviewed manifest update for the same root and project is refreshed. Store at most 256 entries, sorted by project ID.

`list` returns `verification=stored_only`. `resolve --project` rereads the current root and manifest and requires exact ID, name, and hash before returning `manifest_revalidated`. Resolution starts no process or service, creates no Node configuration, and sends no Hub command. A Node uses explicit owner-only configuration for the resolved local root.

Absolute roots are local operational data. They appear only in local or opt-in JSON output, never in events, receipts, Hub synchronization, environment observations, or prompts. Fixed failures distinguish invalid sources, conflicts, concurrency, absence, unavailability, and staleness. Registration proves no document selection, Node start, Hub connection, provider execution, or repository use.

## Consequences

Fixtures cover init/register/list/resolve, idempotency, stale/refresh behavior, conflicts, symlinks, permissions, explicit writes, and stored-versus-revalidated output. The shiflo project was registered on Mac, and a project-scoped launchd Node reached ready through WSL Hub tailnet HTTPS with exact Hub registration verified. Multi-repository instance naming and automatic discovery remain future work.
