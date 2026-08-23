# ADR-0169: User-Local Repository Registration and Revalidation

- Status: accepted
- Decision date: 2026-08-22

## Context

An always-on Hub may run elsewhere, but managed writes must execute on the repository's filesystem. Conversational absolute paths are not durable selection, and stale/moved/reinitialized registrations must not run.

## Decision

@lervo/repository-registry is a per-device discovery index, never project or Hub authority. Defaults follow macOS Application Support, Linux XDG state, or Windows LocalAppData; LERVO_USER_STATE_DIRECTORY is a safe absolute override.

lervo repository register --root <absolute> --write alone mutates it. A real nonsymlink root and valid .lervo/project.yaml are required. Canonical path, project ID/name, full manifest SHA-256, and time are atomically stored in owner-only 0700/0600 state with locking and source recheck.

Conflicting project/root identities never auto-select. Identical registration is unchanged; reviewed same-root/project manifest update is refreshed. At most 256 entries are sorted by project ID.

list returns verification=stored_only. resolve --project rereads current root and manifest and requires exact ID/name/hash before returning manifest_revalidated. Resolve starts no process/service, creates no Node config, and sends no Hub command. A Node uses an explicit owner-only config for the resolved local root.

Absolute roots remain local operational data and appear only in local/opt-in JSON output, never events, receipts, Hub sync, environment observations, or prompts. Fixed failures distinguish invalid source, conflicts, concurrency, absence, unavailability, and staleness. Registration proves no document selection, Node start, Hub connection, provider execution, or repository use.

## Consequences

Fixtures cover init/register/list/resolve, idempotency, stale/refresh, conflicts, symlinks, permissions, explicit write, and stored-vs-revalidated output. The shiflo project was actually registered on Mac and a project-scoped launchd Node reached ready through WSL Hub tailnet HTTPS, with exact Hub registration verified. Multi-repository instance naming and automatic discovery remain future scope.
