# ADR-0088: Packed CLI consumer-installation contract

Status: `accepted`
Decision date: 2026-08-20

## Context

Deploy and pack dry-run did not prove actual tarball install/bin behavior. Broad Claude SDK peer ranges selected untested newer dependencies and broke offline consumer installation.

## Decision

Pin exactly four public dependencies:

- `@anthropic-ai/claude-agent-sdk@0.3.226`
- `@anthropic-ai/sdk@0.117.1`
- `@modelcontextprotocol/sdk@1.30.0`
- `zod@4.4.3`

Only Claude Agent SDK is an external bundle import; the other three satisfy its tested peers. Manifest v2 records all four. Require Node `>=22.13` consistently across build/package/smokes/manifest.

`smoke:packed-cli` builds, makes a real tarball, verifies identity/version/file list, installs it exactly into an empty temporary consumer, validates installed identity/Node/bin/dependencies/files/shebang and absence of workspace coordinates/install scripts/private packages, then runs local shim for version, capabilities, and init.

Prefer local store but allow registry for normal consumer resolution; do not claim a lockfile-free tarball installs fully offline. Runtime smoke commands themselves use no registry/Hub/provider. Remove all temporary artifacts and add no state/schema/event.

## Consequences

Release checks cover real tar installation and bin execution with pinned tested peers, but not published registry downloads, permanent transitive pins, other platforms, provider auth/network, signing, or SBOM.
