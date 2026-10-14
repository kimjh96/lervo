# CLI bundle build configuration and execution

## Evidence boundary

The versioned requirements below are supported by ADR-0503, ADR-0215 and ADR-0502. The build script, package manifest, build helpers and generated outputs were not supplied for this assessment. Descriptions below of script execution order, esbuild options, normalization calls, permission changes, cleanup, metafile emission and helper exports remain implementation descriptions awaiting verification against those owners. They do not establish observed build execution or resulting bytes.

`apps/cli/scripts/build-bundle.mjs` resolves the CLI and repository roots from its location, recursively creates the CLI `dist` directory, and builds the executable entrypoints and internal runtime with the repository as the working directory.

`apps/cli/package.json` registers two `bin` commands, `lervo` and `lervo-node`. The terminal hook has its own bundle. The two commands import the same internal `dist/repository-runtime.js` implementation module.

| Source entrypoint                   | CLI package output           |
| ----------------------------------- | ---------------------------- |
| `apps/cli/src/bin.ts`               | `dist/bin.js`                |
| `apps/cli/src/terminal-hook-bin.ts` | `dist/terminal-hook.js`      |
| `apps/node-runtime/src/bin.ts`      | `dist/node-runtime.js`       |
| Internal CLI/Node composition       | `dist/repository-runtime.js` |

The executable and main runtime builds bundle for Node with target `node22.13`, emit ESM, prefer `module` before `main`, omit legal comments, and use silent esbuild logging. Each adds a banner creating a local `require` through `node:module`'s `createRequire(import.meta.url)` and registers `nodeSqliteBundlePlugin`. The plugin's internal behavior is outside this script's evidence.

Before bundling, the owner must verify the current generated schema validators against their source, compiler options and output manifest. Under ADR-0503, `packages/schemas/scripts/generate-validators.mjs` owns exactly four replaceable files in `dist/generated`: `validators.js`, `selected-validators.js`, `coordinate-data-validators.js` and `manifest.json`. A direct bundle build must reject missing or stale generation. The shared runtime embeds twelve canonical validators and synchronously loads the complete map from its private CJS member on first unselected use. Its owned coordinate JSON parser uses generated coordinate branches through the distribution plugin's exact importer boundary. Ordinary package, Hub and terminal consumers retain the complete validator map. The terminal-hook build alone enables minification to remain below the unchanged 8 MiB limit. See [ADR-0503](../../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md) for ownership, clean-build resolution and error compatibility.

The CLI and packaged Node-runtime builds explicitly keep `@anthropic-ai/claude-agent-sdk` external. The terminal-hook build supplies no explicit external-package list; this alone does not establish which dependencies it imports. [ADR-0215](../../decisions/release/packaging/0215-supported-runtime-release-portability.md) defines consumer-platform selection and SQLite compatibility contracts.

The existing script description reports four awaited concurrent `normalizeGeneratedTextFile` calls after the builds, followed by mode `0755` on `dist/node-runtime.js` and no corresponding chmod for the other executables. The exact call targets, ordering, helper behavior and resulting bytes require verification against the build owner; four calls must not be described as four executable entrypoints.

The script is described as retaining the output directory and having no local catch or rollback. A rejected build or subsequent awaited filesystem operation may therefore leave earlier outputs. This behavior requires build-owner verification.

The existing script description places copying of the verified filesystem-durability and CAS native pairs to `dist/native` after metafile emission. That ordering remains unverified here. Under ADR-0502, current CLI npm archives require all four native files on every platform. A local build's optional capability or omission cannot establish archive compliance. Each supplied pair must match current native sources and pass exact content and universal Mach-O checks. The same-workflow macOS producer and verified transfer contract govern reuse by other platform builds. See [ADR-0502](../../decisions/distribution/0502-bind-native-sync-assets-to-standalone-runtime-distributions.md).

The shared module is an internal application artifact, not a public SDK. Its build helper is described as exporting the existing context preparation, observation, verification, writer inspection and storage contracts alongside the application entry functions, without starting a command or service on import. Those export and import-effect assertions require the helper's implementation evidence. ADR-0502 and ADR-0503 require the main ESM file and `repository-runtime-validators.cjs` in the complete inventory. The distribution boundary also accepts private, flat `repository-runtime-*.js` and `repository-runtime-*.cjs` members when an actual build emits them.

Each runtime build must normalize every emitted output before writing `dist/repository-runtime.json`. This version-1 manifest names the entrypoint and a sorted inventory of file names, byte lengths and SHA-256 hashes. The build must check every output's dependency against emitted members, Node built-ins or the existing external Claude SDK. Names cannot escape the flat namespace or collide by case. The inventory is limited to 128 code files, a 64 KiB manifest and 64 MiB for all code plus the manifest. Undeclared namespace members, missing outputs and stale content must fail verification. A failed build may leave replaceable outputs; those outputs cannot establish a verified complete artifact.

CLI release manifest version 9 compares the expanded npm archive against that inventory; literal package patterns do not replace exact archive membership. SBOM generator version 5 includes one runtime component whose manifest hash binds every member's hash. CLI readers retain earlier schemas. Node archive version 5 uses the same aggregate identity and retains earlier schemas. Upgrade readers before delivering the new manifests. Native asset identities remain independently required.

The shared runtime-security package owns bounded no-follow file capture and inventory validation. Application composition owns source selection and content-addressed installation. Installation validates a private snapshot, checks all existing members for conflicts before writing any missing member, and publishes the manifest last. It can repair missing files after interruption, but preserves and rejects changed bytes, links or foreign namespace members. The source is not reopened after admission. Complete verification follows publication; these checks do not establish live-service atomic replacement or power-loss recovery.
