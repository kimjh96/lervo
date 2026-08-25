# ADR-0215: Supported-runtime release portability

Status: `accepted`
Decision date: 2026-08-25

## Context

Lervo supports Node.js 22.13 and later, but release checks must not infer that boundary from the Node version running the check. Node 22.13 can load `node:sqlite` while omitting it from `builtinModules`, and emits an experimental warning whenever the module loads. Windows CI may place the repository and temporary deployment target on different volumes, where pnpm's default package import strategy is not portable.

## Decision

- Treat every `node:` specifier as a Node built-in independently of the current runtime's `builtinModules` inventory. Use one shared classifier for CLI, Hub, and Node release validation.
- Bundle a provider-neutral SQLite compatibility module into every executable. It temporarily intercepts only the exact Node `ExperimentalWarning` for loading `node:sqlite`, restores `process.emitWarning` synchronously, and forwards every other warning unchanged.
- Keep `node:sqlite` external at the final runtime boundary. The compatibility module must not recursively resolve itself. Packed-consumer smoke must execute `lervo init` on Node 22.13 with empty stderr.
- Force pnpm's `copy` package import method for temporary CLI and standalone Node deployments so release verification works across Windows volumes without hardlinks.
- Normalize bundle metadata paths. On unexpected release-check failures, expose bounded child-process stdout and stderr. Diagnostics may contain build output but must not include prompts, credentials, provider configuration, or user documents.

No execution event or persistent runtime state is added. Release manifests and SBOMs continue to bind the changed executable bytes.

## Consequences

The minimum supported Node runtime becomes a tested consumer boundary rather than an assumption derived from a newer build host. Packaged commands remain quiet without globally disabling warnings, and the same release logic applies on macOS, Linux, and Windows. Future Node upgrades must retain the exact warning filter until the minimum supported runtime no longer emits it. The compatibility module may then be removed only with a regenerated manifest, SBOM, and matrix proof.
