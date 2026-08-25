# Code convention

Status: `active`
As of: 2026-08-25

Lervo uses ESLint for code-quality defects and Prettier for deterministic formatting. `eslint-config-prettier` disables overlapping formatting rules; ESLint does not run Prettier.

## Scope and defaults

- ESLint applies the upstream recommended JavaScript and TypeScript rules to repository JavaScript, MJS, CJS, and TypeScript sources.
- TypeScript remains in strict mode. `pnpm typecheck` is the authoritative type-analysis gate; fast lint does not repeat project-wide typed analysis.
- Prettier uses two-space indentation, semicolons, double quotes, supported trailing commas, a 100-column target, LF line endings, and final newlines for code and configuration files.
- Browser globals apply only to `apps/hub/assets/**/*.js`; other JavaScript uses Node globals.
- Markdown is excluded from formatting because Lervo's reviewed document lifecycle owns those bytes; formatting normalized Markdown would create a provider-normalization loop.
- Also excluded are dependencies, build output, coverage, Lervo durable or rebuildable stores, generated knowledge registries and publications, generated release manifests, the generated SBOM, the pnpm lockfile, and provider instruction bridges. Their owning checks verify documents, generated artifacts, and managed instruction blocks.
- Disposable ESLint and Prettier caches are stored under ignored `node_modules/.cache/lervo/`.

Do not disable a rule repository-wide to bypass a finding. Correct the code when possible. When an exception is necessary, place a narrow inline disable beside its reason. Unused disable directives fail lint.

## Commands

```bash
pnpm lint
pnpm lint:fix
pnpm format:check
pnpm format
pnpm quality:check
```

`pnpm check` includes `pnpm quality:check`. Pull requests and pushes to `main` also run the dedicated code-quality workflow. Run broad fix commands only when their resulting diff is within the active task; otherwise format or lint only the affected paths.
