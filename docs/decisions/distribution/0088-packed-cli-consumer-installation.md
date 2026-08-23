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

`smoke:packed-cli` must build a real tarball; verify its identity, version, and file list; install it exactly into an empty temporary consumer; and validate installed identity, Node requirement, bin, dependencies, files, shebang, and the absence of workspace coordinates, install scripts, and private packages. It then runs the local shim for version, capabilities, and init.

Prefer the local store, but allow the registry for normal consumer resolution. Do not claim that a lockfile-free tarball installs fully offline. Runtime smoke commands use no registry, Hub, or provider. Remove all temporary artifacts and add no state, schema, or event.

## Consequences

Release checks cover real tar installation and bin execution with pinned, tested peers. They do not cover published registry downloads, permanent transitive pins, other platforms, provider authentication or network access, signing, or SBOM.
