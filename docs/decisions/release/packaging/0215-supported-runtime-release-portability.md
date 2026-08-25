# ADR-0215: Supported-runtime release portability

Status: `accepted`
Decision date: 2026-08-25

## Context

Lervo supports Node.js 22.13 and later. Release checks must not infer this boundary from the Node version running the check. Node 22.13 can load `node:sqlite`, but omits it from `builtinModules` and emits an experimental warning when it loads. Windows CI may place the repository and temporary deployment target on different volumes, making pnpm's default package import strategy non-portable.

## Decision

- Treat every `node:` specifier as a Node built-in, independently of the current runtime's `builtinModules` inventory. Use one shared classifier for CLI, Hub, and Node release validation.
- Bundle a provider-neutral SQLite compatibility module into every executable. It temporarily intercepts only the exact Node `ExperimentalWarning` for loading `node:sqlite`, synchronously restores `process.emitWarning`, and forwards every other warning unchanged.
- Keep `node:sqlite` external at the final runtime boundary. The compatibility module must not recursively resolve itself. Packed-consumer smoke tests must run `lervo init` on Node 22.13 with empty stderr.
- Force the `copy` package import method for temporary CLI and standalone Node deployments. On Windows, use pnpm's legacy deploy implementation against the installed closure, disable its redundant minimum-release-age metadata lookup after the frozen root install has enforced supply-chain policy, and then restore pnpm's rebuildable workspace-state cache. Other platforms retain shared-lockfile deploy. This must work offline across Windows volumes without hardlinks, registry metadata, or a second registry tarball.
- Normalize bundle metadata paths. On unexpected release-check failures, expose bounded child-process stdout and stderr. Diagnostics may contain build output, but must not contain prompts, credentials, provider configuration, or user documents.

No execution event or persistent runtime state is added. Release manifests and SBOMs continue to bind the changed executable bytes.

## Consequences

The minimum supported Node runtime becomes a tested consumer boundary instead of an assumption derived from a newer build host. Packaged commands remain quiet without globally disabling warnings, and the same release logic applies on macOS, Linux, and Windows. Future Node upgrades must retain the exact warning filter until the minimum supported runtime no longer emits the warning. The compatibility module may then be removed only with a regenerated manifest, SBOM, and matrix proof.
