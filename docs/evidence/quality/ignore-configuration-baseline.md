# Git and formatter ignore baseline

This baseline records the supplied `.gitignore` and `.prettierignore` configuration. It does not establish successful tool execution or any file's tracking status.

## Git exclusions

`.gitignore` contains these patterns:

```gitignore
node_modules/
dist/
.DS_Store
coverage/
*.tsbuildinfo
```

It also contains `docs/knowledge/` in the managed region delimited by `# lervo:begin rebuildable-knowledge schema=1` and `# lervo:end rebuildable-knowledge`. When editing the source, preserve these delimiters and the distinction between managed and user-owned content.

After the managed region, it excludes Lervo ADE build outputs:

```gitignore
apps/ade/target/
apps/ade/src-tauri/gen/
apps/ade/dist-catalog/
```

Ignore rules do not remove already tracked files from Git. These patterns do not prove that matching directories exist or that their contents are safe to delete.

## Formatter exclusions

The complete `.prettierignore` pattern list is:

```text
node_modules/
**/dist/
coverage/
.lervo/data/
.lervo/generated/
.lervo/knowledge/
.lervo/state/
docs/knowledge/
apps/cli/release-artifact-manifest.json
apps/cli/release-sbom.cdx.json
pnpm-lock.yaml
eslint-suppressions.json
apps/ade/target/
apps/ade/src-tauri/gen/
apps/ade/src-tauri/icons/
packages/session-host-contract/generated/
apps/ade/src/design/generated/
apps/ade/src/i18n/generated/
```

These exclusions configure formatting scope. They do not independently establish Git exclusions, generated-file ownership, validation exemptions, or publication authority. The supplied `.gitignore` does not list the four `.lervo` paths, release metadata files, lockfile, `eslint-suppressions.json`, ADE icons, or the generated session-host contract, design, and i18n directories above; it shares only `apps/ade/target/` and `apps/ade/src-tauri/gen/` among the ADE paths. Other ignore sources and actual repository tracking were not supplied.

[CLI version and release management](../../distribution/cli-version-management.md) governs release metadata ownership and regeneration. A formatter exclusion does not establish that a manifest, SBOM, or lockfile is current or verified.
