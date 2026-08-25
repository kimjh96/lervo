# ADR-0215: Supported-runtime release portability

Status: `accepted`
Decision date: 2026-08-25

## Context

Lervo supports Node.js 22.13 and later. Release checks must not infer this boundary from the runtime executing the check. Node 22.13 can load `node:sqlite`, but omits it from `builtinModules` and emits an experimental warning when loading it. On Windows, the repository and temporary deployment target may be on different volumes, making pnpm's default package import strategy non-portable.

## Decision

- Treat every `node:` specifier as a Node built-in regardless of the current runtime's `builtinModules` inventory. Use one shared classifier for CLI, Hub, and Node release validation.
- Bundle a provider-neutral SQLite compatibility module into every executable. It must temporarily intercept only the exact Node `ExperimentalWarning` for loading `node:sqlite`, synchronously restore `process.emitWarning`, and forward every other warning unchanged.
- Keep `node:sqlite` external at the final runtime boundary. The compatibility module must not recursively resolve itself. Packed-consumer smoke tests must run `lervo init` on Node 22.13 with empty stderr.
- Force the `copy` package import method and retain pnpm's shared-lockfile deploy implementation for temporary CLI and standalone Node deployments. macOS and Linux deployments must be offline. Windows may fetch an exact integrity-locked tarball when its cross-volume content-addressable store cannot rematerialize it, while preferring the installed store and preserving the frozen lockfile closure. Restore pnpm's rebuildable workspace-state cache after every deployment.
- Normalize bundle metadata paths. For unexpected release-check failures, expose bounded child-process stdout and stderr. Diagnostics may include build output, but must exclude prompts, credentials, provider configuration, and user documents.

This adds no execution event or persistent runtime state. Release manifests and SBOMs continue to bind the changed executable bytes.

## Consequences

The minimum supported Node runtime becomes a tested consumer boundary rather than an assumption derived from a newer build host. Packaged commands remain quiet without globally disabling warnings, and the same release logic applies on macOS, Linux, and Windows. Future Node upgrades must retain the exact warning filter until the minimum supported runtime stops emitting the warning. The compatibility module may then be removed only with a regenerated manifest, SBOM, and matrix proof.
