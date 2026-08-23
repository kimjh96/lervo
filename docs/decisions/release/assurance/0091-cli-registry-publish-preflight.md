# ADR-0091: CLI registry-publish preflight contract

Status: `accepted`
Decision date: 2026-08-20

## Context

Local tar install does not prove registry metadata/tags/package-coordinate reinstall or immutable-version rejection. Real npm requires scope authority, credentials, repository, and license decisions not yet available, so preflight must mutate only an isolated registry.

## Decision

- Pin Verdaccio 6.10.0 and run it programmatically on loopback ephemeral port with all config/storage/cache under a temporary root.
- Disable uplinks/UI/unpublish; allow all reads and anonymous first publish only for `@lervo/*` under fixture policy.
- Clear inherited case variants of npm registry/proxy/auth environment; use empty user config and fixture cache, never user home/repo config.
- Default failure is source-free `registry_publish_preflight_failed`; only explicit local `LERVO_REGISTRY_PREFLIGHT_DEBUG=1` may show tool errors/temp paths.
- Pack the shared three-file tarball, publish with `preflight` tag, verify registry identity/version/license/SHA-512 integrity, `preflight` and `latest`, exact-coordinate consumer install, local bin version, explicit pnpm `[E409] 409 Conflict` on republish, and unchanged integrity afterward.
- Scope only `@lervo` to fixture registry so external Claude dependencies may resolve normally. Run after packed smoke on all matrix OSes.
- Clean server/storage/tar/consumer/config/cache; add no runtime state/event.

## Consequences

Local npm-compatible publish/install/immutability is tested without claiming real npm ownership/auth/2FA/trusted publishing/provenance/CDN/deletion or unexecuted OS success.
