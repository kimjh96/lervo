# ADR-0503: Compile schema validators at build time

Status: `accepted`
Decision date: 2026-10-11

## Context

The [bundled query diagnosis](../../../evidence/quality/context-quality/overview.md#bundled-query-diagnosis) identifies eager compilation of 209 schemas as a substantial fresh-process startup cost. Validation itself remains required at every existing boundary. Generated code must preserve invalid-input errors as well as accepted values, and must fit the existing terminal runtime size limit.

## Decision

The schemas package owns a build-only compiler and a declarative catalog. Its public `validateSchema` facade calls generated validators without constructing Ajv or evaluating generated strings at runtime. Existing schema names, schema definitions, date-time semantics, verdicts and error arrays remain the contract. The private package import resolves authored types before a build and generated JavaScript during execution; public exports are unchanged.

Generation retains strict mode, all errors and inline references. Required-property and enum loops use thresholds 1 and 3, and code optimization uses level 2. These settings affect generated representation, not validation policy. Disabling inline references is rejected because fixture comparisons exposed different `schemaPath` errors. The original runtime compiler settings remain the test oracle.

Generator version 2 indexes static primitive enum lists that meet the existing enum-loop threshold. Its build-only keyword adapter retains Ajv's error definition and uses the original compiler for short lists, object/array members and request-defined `$data` enums. The generated runtime lazily creates one membership set per referenced schema array. A private weak map owns those sets; its keys and members come only from the finite compiled catalog, never requests, repository observations or caller-provided enum lists. The generated artifact size limit also bounds the source catalog represented by those indexes. No accepted-value cache is introduced.

The public validation facade deep-copies failed error arrays, including nested parameters. Returning the generated validator's enum array allowed a caller to add an unsupported event type and change subsequent validation. Error contents and ordering remain unchanged, but their mutable objects no longer alias shared schema definitions. The private generated validator and its static enum arrays are not public package exports.

`packages/schemas/scripts/generate-validators.mjs` owns exactly two replaceable files in `dist/generated`: `validators.js` and `manifest.json`. The manifest requires schema and generator versions, sorted repository-relative source paths and SHA-256 hashes, their aggregate hash, schema count, Ajv/esbuild versions, compiler options, output hash and byte length. Source identity includes all schema TypeScript, the lockfile, package configuration and generation/verification owners. It detects drift; it is not an independent build attestation. No absolute workspace paths, timestamps or request content enter these artifacts.

The compiler also derives a sorted, bounded `runtimeDependencies` inventory from the generated bundle's actual inputs. Release snapshot and SBOM owners combine this inventory with the outer bundle inputs. Ajv runtime helpers and `fast-deep-equal` therefore retain their package identities even though the outer bundle sees one generated file; compiler-only URI and schema-traversal dependencies leave the bundled inventory. The release checker keeps an exact reviewed package set.

Generation exclusively creates one fixed `.generation` staging directory, writes the pair and then renames each output. An interrupted pair cannot pass the content/source check. Only the invocation that acquired the directory removes it during cleanup. An occupied stage stops another generator before compilation; after confirming no generator is active, the build owner can remove the retained stage and regenerate this disposable pair. Repeated attempts cannot accumulate per-run directories. Manifest input is capped at 256 KiB, generated JavaScript at 16 MiB, and source inventory at 1,024 paths. Linked output files or a linked generated directory are rejected.

The package build generates before TypeScript compilation. Vitest verifies or regenerates once before source imports. CLI, Hub and Node bundle owners require a current exact pair before bundling; missing or stale artifacts cannot silently trigger runtime compilation. Generated validators and Ajv runtime helpers are embedded in the existing executable bundles, so consumers install no new sidecar or compiler.

The release-impact classifier treats the compiler, keyword adapter, generator and artifact-verification owners as released tooling. Changing only one of these build-time files can alter packaged behavior, so it requires reviewed release intent even when runtime source files are unchanged.

The terminal bundle is minified to preserve its unchanged 8 MiB bound. Function names are not retained as a separate runtime contract. CLI, Hub and Node bundle formatting remains unchanged. Installed hook integrity and observable error behavior require consumer verification of the final bytes.

## Failure and privacy

This change adds no event, repository state, user configuration or telemetry claim. The finite enum indexes retain only schema constants for the generated module's lifetime. The manifest contains public source coordinates and hashes only. Source limits or linked source entries fail with `schema_validator_source_limit` or `schema_validator_source_invalid`; malformed, linked or oversized artifacts fail with `schema_validator_artifact_invalid`; changed source, options or output fail with `schema_validator_artifact_stale`. Oversized generation fails with `schema_validator_artifact_limit`. Filesystem, parse and compiler errors stop the build. No permissive validation fallback exists.

## Verification and completion

Differential tests compare every catalog name, all existing JSON fixtures and field mutations against the prior compiler, including exact error arrays. A separate process forbids code generation from strings. Clean-copy tests typecheck before generation, build without prior output, execute the public package and compare generated bytes and manifests across different absolute roots. Artifact tests reject missing, linked, changed and mismatched inputs.

Full regression, package boundaries, generated release metadata, supported installed consumers and exact terminal size remain required. Fresh-process diagnostics must bind the new executable bytes and preserve the earlier observations. Lower startup cost does not satisfy the independently frozen timed-core resource gates, reviewed real-task quality, production rollout or operational observation requirements.
