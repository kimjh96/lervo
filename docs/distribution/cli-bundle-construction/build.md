# CLI bundle build configuration and execution

`apps/cli/scripts/build-bundle.mjs` resolves the CLI and repository roots from its location, recursively creates the CLI `dist` directory, and runs three sequential esbuild builds with the repository as the working directory.

`apps/cli/package.json` registers two `bin` commands, `lervo` and `lervo-node`. The terminal hook is the third shipped JavaScript file, but is not a package `bin` command.

| Source entrypoint | CLI package output |
| --- | --- |
| `apps/cli/src/bin.ts` | `dist/bin.js` |
| `apps/cli/src/terminal-hook-bin.ts` | `dist/terminal-hook.js` |
| `apps/node-runtime/src/bin.ts` | `dist/node-runtime.js` |

All three builds bundle for Node with target `node22.13`, emit ESM, prefer `module` before `main`, omit legal comments, and use silent esbuild logging. Each adds a banner creating a local `require` through `node:module`'s `createRequire(import.meta.url)` and registers `nodeSqliteBundlePlugin`. The plugin's internal behavior is outside this script's evidence.

The CLI and packaged Node-runtime builds explicitly keep `@anthropic-ai/claude-agent-sdk` external. The terminal-hook build supplies no explicit external-package list; this alone does not establish which dependencies it imports. [ADR-0215](../../decisions/release/packaging/0215-supported-runtime-release-portability.md) defines consumer-platform selection and SQLite compatibility contracts.

After all builds complete, the script concurrently calls `normalizeGeneratedTextFile` for each executable and awaits all three calls. It then sets `dist/node-runtime.js` to mode `0755`; it contains no corresponding chmod for the other executables. The normalization helper's implementation and resulting bytes require separate verification.

The script does not clean the output directory before building and has no local catch or rollback. A rejected build or subsequent awaited filesystem operation stops further execution; earlier outputs can remain.
