# CLI bundle build configuration and execution

`apps/cli/scripts/build-bundle.mjs` resolves the CLI and repository roots from its location, recursively creates the CLI `dist` directory, and builds the executable entrypoints and internal runtime with the repository as the working directory.

`apps/cli/package.json` registers two `bin` commands, `lervo` and `lervo-node`. The terminal hook has its own bundle. The two commands import the same internal `dist/repository-runtime.js` implementation module.

| Source entrypoint                   | CLI package output           |
| ----------------------------------- | ---------------------------- |
| `apps/cli/src/bin.ts`               | `dist/bin.js`                |
| `apps/cli/src/terminal-hook-bin.ts` | `dist/terminal-hook.js`      |
| `apps/node-runtime/src/bin.ts`      | `dist/node-runtime.js`       |
| Internal CLI/Node composition       | `dist/repository-runtime.js` |

The executable and main runtime builds bundle for Node with target `node22.13`, emit ESM, prefer `module` before `main`, omit legal comments, and use silent esbuild logging. Each adds a banner creating a local `require` through `node:module`'s `createRequire(import.meta.url)` and registers `nodeSqliteBundlePlugin`. The plugin's internal behavior is outside this script's evidence.

Before bundling, the owner verifies the current generated schema validators against their source, compiler options and output manifest. The schemas package build creates the complete map, selected map and manifest; a direct bundle build rejects missing or stale generation. The shared runtime embeds twelve canonical validators and synchronously loads the complete map from its private CJS member on first unselected use. Other bundles retain the complete embedded map. The terminal-hook build alone enables minification to remain below the unchanged 8 MiB limit. See [ADR-0503](../../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md) for ownership, clean-build resolution and error compatibility.

The CLI and packaged Node-runtime builds explicitly keep `@anthropic-ai/claude-agent-sdk` external. The terminal-hook build supplies no explicit external-package list; this alone does not establish which dependencies it imports. [ADR-0215](../../decisions/release/packaging/0215-supported-runtime-release-portability.md) defines consumer-platform selection and SQLite compatibility contracts.

After all builds complete, the script concurrently calls `normalizeGeneratedTextFile` for each executable and awaits all four calls. It then sets `dist/node-runtime.js` to mode `0755`; it contains no corresponding chmod for the other executables. The normalization helper's implementation and resulting bytes require separate verification.

The script does not clean the output directory before building and has no local catch or rollback. A rejected build or subsequent awaited filesystem operation stops further execution; earlier outputs can remain.

After emitting the metafile, the build copies the verified filesystem-durability and CAS native pairs to `dist/native`. Darwin requires all four files; ordinary non-Darwin local builds may omit it, but release archive verification requires all four files. Each supplied pair must match current native sources and passes exact content and universal Mach-O checks. CI restores one same-workflow macOS artifact before platform builds; valid transferred bytes are reused without recompilation. See [ADR-0502](../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md).

The shared module is an internal application artifact, not a public SDK. Its build helper exports the existing context preparation, observation, verification, writer inspection and storage contracts alongside the application entry functions. Importing it does not start a command or service. The current implementation emits the main ESM file and `repository-runtime-validators.cjs`; both are required inventory members. The distribution boundary also accepts private, flat `repository-runtime-*.js` and `repository-runtime-*.cjs` members when an actual build emits them.

Each runtime build normalizes every emitted output before writing `dist/repository-runtime.json`. This version-1 manifest names the entrypoint and a sorted inventory of file names, byte lengths and SHA-256 hashes. The build checks every output's dependency against emitted members, Node built-ins or the existing external Claude SDK. Names cannot escape the flat namespace or collide by case. The inventory is limited to 128 code files, a 64 KiB manifest and 64 MiB for all code plus the manifest. Undeclared namespace members, missing outputs and stale content fail verification. A failed build may leave replaceable outputs but cannot produce a verified incomplete artifact.

CLI release manifest version 9 compares the expanded npm archive against that inventory; literal package patterns do not replace exact archive membership. SBOM generator version 5 includes one runtime component whose manifest hash binds every member's hash. CLI readers retain versions 5 through 8. Node archive version 5 uses the same aggregate identity and retains versions 1 through 4. Upgrade readers before delivering the new manifests. Native asset identities remain independently required.

The shared runtime-security package owns bounded no-follow file capture and inventory validation. Application composition owns source selection and content-addressed installation. Installation validates a private snapshot, checks all existing members for conflicts before writing any missing member, and publishes the manifest last. It can repair missing files after interruption, but preserves and rejects changed bytes, links or foreign namespace members. The source is not reopened after admission. Complete verification follows publication; these checks do not establish live-service atomic replacement or power-loss recovery.
