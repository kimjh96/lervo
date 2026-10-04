# ADR-0215: Supported-runtime release portability

Status: `accepted`
Decision date: 2026-08-25

## Context

Lervo supports Node.js 22.13 and later. Release checks must not infer this boundary from their executing runtime. Node 22.13 loads `node:sqlite` but omits it from `builtinModules` and emits an experimental warning when loading it. On Windows, the repository and temporary deployment target may be on different volumes, making pnpm's default package import strategy non-portable.

## Decision

- Classify every `node:` specifier as a Node built-in regardless of the executing runtime's `builtinModules` inventory. Share one classifier across CLI, Hub, and Node release validation.
- Bundle a provider-neutral SQLite compatibility module into every executable. Intercept only the exact Node `ExperimentalWarning` emitted while loading `node:sqlite`, synchronously restore `process.emitWarning`, and forward every other warning unchanged.
- Keep `node:sqlite` external at the final runtime boundary. The compatibility module must not recursively resolve itself. Packed-consumer smoke tests must run `lervo init` on Node 22.13 with empty stderr.
- Keep `@anthropic-ai/claude-agent-sdk` external in both provider-invoking CLI entrypoints, including the packaged Node runtime. The consumer installation, never the build host, must select its platform-native implementation.
- Compare security-sensitive file identities and timestamps using Node's exact bigint filesystem metadata. Compare identities from opened handles; do not mix path and handle metadata, because Windows may report different identifiers for these lookup mechanisms. Retain path-level symbolic-link checks before and after reading.
- Derive temporary sibling paths with the host platform's path APIs. Never parse an absolute filesystem path using repository-relative POSIX separators.
- Force the `copy` package import method and retain pnpm's shared-lockfile deploy implementation for temporary CLI and standalone Node deployments. macOS and Linux deployments must be offline.
- On Windows, deployment may fetch an exact integrity-locked tarball only when the cross-volume content-addressable store cannot rematerialize a package. Prefer the installed store and preserve the frozen lockfile closure.
- Restore pnpm's rebuildable workspace-state cache after every deployment.
- Apply the repository-root `.gitattributes` rule `* text=auto eol=lf` to all repository paths. Under `text=auto`, Git classifies content as text or binary; only text receives LF checkout line endings. The rule does not normalize binary content. Normalize generated executable text to LF immediately after bundling. Public package files and release digests must be byte-identical across Windows, macOS, and Linux.
- Normalize bundle metadata paths.
- For unexpected release-check failures, expose bounded child-process stdout and stderr. Archive mismatch diagnostics may expose only public package paths, byte counts, and SHA-256 digests. Diagnostics may include build output but must exclude prompts, credentials, provider configuration, and user documents.

This decision adds no execution event or persistent runtime state. Release manifests and SBOMs continue to bind the changed executable bytes.

## Consequences

The minimum supported Node runtime becomes a tested consumer boundary rather than an assumption derived from a newer build host. Packaged commands remain quiet without globally disabling warnings, and the same release logic applies on macOS, Linux, and Windows.

Future Node upgrades must retain the exact warning filter until the minimum supported runtime stops emitting the warning. The compatibility module may then be removed only with a regenerated manifest, SBOM, and matrix proof.
