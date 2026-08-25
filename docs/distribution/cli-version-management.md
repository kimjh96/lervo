# CLI version and release management

Lervo uses reviewed release-intent files to prepare `@lervo/cli` versions. Preparation may change repository bytes and create the exact release tag, but cannot stage or publish an npm package.

## Contributor intent

Add one intent when a pull request changes public CLI behavior or implementation in a private workspace package bundled into the CLI:

```bash
pnpm release:intent:create --impact patch --summary "Correct bounded diagnostics for unavailable provider entrypoints."
```

Use `patch` for a compatible correction, `minor` for compatible new behavior, and `major` for an incompatible public contract. Before 1.0, `minor` and `major` both advance the minor number, while `major` preserves the reviewed breaking-change meaning. A Conventional Commit `!` or `BREAKING CHANGE` marker requires a matching `major` intent and never replaces it.

Tests, documentation, release-management files, and internal refactors outside the packed CLI dependency closure are exempt. Refactors inside that closure require intent because the checker cannot prove packaged behavior is unchanged. CI rejects missing, malformed, content-ID-mismatched, or unnecessary records.

## Release pull request

On `main`, `.github/workflows/release-preparation.yml` aggregates pending intent into the fixed `lervo/release-cli` branch. Review the public version, sorted changelog summaries, lockfile, release artifact manifest, SBOM, consumed intent, and exact source revision. The source commit date determines the changelog date, making repeated workflow runs byte-stable. New intent updates the same pull request.

Generated files retain their existing owners. The workflow runs frozen lockfile installation, the build, `release:manifest:update`, and `release:sbom:update`. Do not manually edit version-bound fields. A conflict or failed generator restores local inputs and fails the workflow for correction.

## Tag handoff and recovery

After the release pull request merges, the workflow verifies clean `main`, the versioned changelog, matching generated metadata, no remaining intent, and tag absence. It creates and pushes the annotated `v<version>` tag, which triggers the existing three-platform packed-consumer and attestation pipeline to revalidate source and artifact coordinates.

If tag creation has an uncertain result, rerun the workflow. An exact annotated tag at the planned revision is accepted as a recovered replay. A lightweight tag or tag at another revision is a conflict. Do not move or delete it automatically; resolve Git authority separately, then rerun the exact plan.

Emergency corrections require a new `patch` or reviewed higher-impact intent and the ordinary release pull request. V1 has no prerelease channel. Version preparation and tag creation prove only those Git operations; npm stage approval, Trusted Publisher configuration, and publication retain independent authorization.
