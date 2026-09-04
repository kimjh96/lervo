# ADR-0088: Packed CLI consumer-installation contract

- Status: accepted
- Decision date: 2026-08-20

## Context

Deploy and pack dry-runs did not prove real tarball installation or bin behavior. Broad Claude SDK peer ranges selected untested newer dependencies and broke offline consumer installation.

## Decision

Pin exactly four public dependencies:

- `@anthropic-ai/claude-agent-sdk@0.3.226`
- `@anthropic-ai/sdk@0.117.1`
- `@modelcontextprotocol/sdk@1.30.0`
- `zod@4.4.3`

Only Claude Agent SDK is an external bundle import; the other three satisfy its tested peers. Manifest v2 records all four. Require Node `>=22.13` across builds, packages, smokes, and manifests.

`smoke:packed-cli` must:

- Build a real tarball and verify its identity, version, and file list.
- Install it exactly into an empty temporary consumer.
- Validate the installed identity, Node requirement, bin, dependencies, files, shebang, and absence of workspace coordinates, install scripts, and private packages.
- Run the local shim for version, capabilities, and init.

Prefer the local store, but allow the registry for normal consumer resolution. Do not claim that a lockfile-free tarball installs fully offline. Runtime smoke commands use no Hub or provider.

The installed CLI must advertise the shared event-reader capability, initialize its own temporary event store, prove default-v1 status plus exact local activation and writer rollback, and reproduce an exact linked version 1/version 2 fixture through the bounded trace surface. A deployment-proof fixture adapter may insert only into that disposable empty database; it is not shipped, exported, or available to production writers. Remove all temporary artifacts and add no repository state, schema, or event.

## Consequences

Release checks cover real tar installation and bin execution with pinned, tested peers, the packed reader's capability advertisement, local writer selection and rollback, and mixed-history replay. They do not cover published registry downloads, permanent transitive pins, other platforms, provider authentication or network access, distributed reader-inventory authority, signing, or SBOM.
