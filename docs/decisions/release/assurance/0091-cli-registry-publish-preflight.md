# ADR-0091: CLI registry-publish preflight contract

Status: `accepted`
Decision date: 2026-08-20
Amended by: [ADR-0569](../packaging/0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (inherited pnpm configuration is cleared, and failures print the tool error and output)

## Context

A local tar install does not prove registry metadata, tags, package-coordinate reinstall, or immutable-version rejection. Real npm requires scope authority, credentials, repository, and license decisions that are not yet available, so preflight must mutate only an isolated registry.

## Decision

- Pin Verdaccio 6.10.0 and run it programmatically on an ephemeral loopback port, with all configuration, storage, and cache under a temporary root.
- Disable uplinks, UI, and unpublish. Allow all reads and anonymous first publish only for `@lervo/*` under fixture policy.
- Clear inherited case variants of npm registry, proxy, and auth environment variables. Use an empty user configuration and fixture cache, never user home or repository configuration.
- By default, failures use the source-free `registry_publish_preflight_failed`. Only explicit local `LERVO_REGISTRY_PREFLIGHT_DEBUG=1` may expose tool errors or temporary paths.
- Pack the shared three-file tarball; publish it with the `preflight` tag; verify registry identity, version, license, and SHA-512 integrity; verify `preflight` and `latest`; perform an exact-coordinate consumer install; verify the local binary version; require explicit pnpm `[E409] 409 Conflict` on republish; and verify unchanged integrity afterward.
- Scope only `@lervo` to the fixture registry so external Claude dependencies may resolve normally. Run after packed smoke on every matrix OS.
- Clean the server, storage, tarball, consumer, configuration, and cache. Add no runtime state or event.

## Consequences

Local npm-compatible publishing, installation, and immutability are tested without claiming real npm ownership, authentication, 2FA, trusted publishing, provenance, CDN behavior, deletion behavior, or success on an OS where the test was not executed.
