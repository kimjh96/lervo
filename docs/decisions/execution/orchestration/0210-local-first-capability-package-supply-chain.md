# ADR-0210: Local-first capability package supply chain

- Status: accepted
- Decision date: 2026-08-25

Partially superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the client side of optional Hub sharing is removed. Lervo no longer ships `lervo capability publish`, `lervo capability pull`, their HTTP client, or `capability_hub_failed`. Local validation, installation, resolution, the lock projection, and the Hub registry endpoint stay.

## Context

Lervo resolves project and user skills but previously only inventoried MCP server definitions and provider plugins. Users need one local-first mechanism to validate, install, bind, and optionally share reusable capabilities without making Hub availability, provider-specific configuration, or automatic publication part of core execution.

## Decision

### Package boundary

`lervo-capability.json` is the versioned contract for `skill`, `mcp_server`, `provider_plugin`, and `bundle` packages. It binds an immutable ID, semantic version, content hash, provenance, provider and platform compatibility, required role permissions, exact dependency coordinates, a kind-specific entrypoint, explicit activation, and publication privacy. Package and entrypoint kinds must agree.

Packages contain at most 256 regular files and 16 MiB. Discovery follows no symlinks and rejects path escape, mutation during reads, hidden content except native plugin manifests, and conventional credential, private-key, or secret filenames. Safe reads compare identity and metadata across repeated path observations and independently across repeated open-handle observations. Path-to-handle identity fields are compared only where the platform defines them compatibly. On Windows, cross-surface association uses bounded size and modification time; repeated observations and the immutable package content hash remain fail-closed.

Manifests never contain credential values. MCP packages name required environment credentials and reference configuration and hashed provider-neutral runtime descriptors. `publication.secretMaterial` is always `excluded`.

Project packages live lazily under `.lervo/capabilities/packages/`; user packages live under `~/.lervo/capabilities/packages/`. Installation is content-bound, plan-first, and atomic. An occupied immutable coordinate is idempotent only when its content hash matches; otherwise it conflicts. Local installation and execution require no Hub.

### Resolution and execution claims

`lervo capability resolve` applies project-before-user precedence, provider and platform compatibility, role permission checks during managed execution, exact transitive dependencies, cycle and depth limits, and an immutable `.lervo/capabilities.lock`. Bundles resolve their exact members. The lock is rebuildable resolution state.

`resolved` does not mean `loaded`, `injected`, `activated`, or `used`. MCP and plugin activation remains behind provider adapters. Codex and Claude implement the provider-confirmed, fail-closed boundary in [ADR-0211](../providers/0211-provider-confirmed-capability-activation.md). A skill capability may request its declared skill ID through the existing skill resolver. The independently valid skill package must be present; its existing lock and evidence rules remain authoritative.

Roles may declare `defaultCapabilityPackages`. Hired agents bind exact resolved package versions and hashes into their capability hash. Subagents inherit their parent's package set by default and may narrow, never expand, it. Managed workforce execution re-resolves packages and rejects any missing, changed, or newly added coordinate before provider creation. Root agents and subagents otherwise share execution, lease, handoff, and verification contracts.

### Optional Hub sharing

Hub sharing is opt-in. `publish` and `pull` each produce a content-bound plan and require explicit `--apply --approval <plan-hash>`. Lervo never uploads automatically. Bearer values come from a named environment variable and never appear in plans, receipts, errors, manifests, locks, or package records.

Hub scopes are `project`, bound to an authorized destination and project, or `public`. Separate `capability.publish` and `capability.read` permissions apply. The Hub stores immutable package envelopes in an atomic filesystem registry. Same-content retries are idempotent; different content at one coordinate conflicts. Hub unavailability never blocks local packages or execution.

Organization catalog policy and trust signatures require later contracts. Public availability and publisher identity imply neither.

### State, privacy, and failures

Canonical local state is the validated package bytes. `.lervo/capabilities.lock` is a derived projection containing only IDs, kinds, versions, hashes, local source scopes, and `resolved` status. Hub publication records add scope, publisher principal ID, and publication time; they exclude credentials and runtime configuration values. CLI receipts report immediate operation results, not execution or use evidence.

| Failure | Meaning |
| --- | --- |
| `capability_invalid` | The manifest, envelope, coordinate, or lock violates the v1 contract. |
| `capability_unsafe_package` | A path, file type, secret-shaped filename, size, count, or read race is unsafe. |
| `capability_content_hash_mismatch` | Package bytes do not match the immutable manifest hash. |
| `capability_not_found`, `capability_unsupported` | No compatible package exists, or role permission is insufficient. |
| `capability_conflict` | Dependency coordinates conflict, the dependency graph is cyclic, or immutable storage contains different content. |
| `capability_approval_mismatch`, `capability_write_failed` | Apply authority is stale, or atomic local publication failed. |
| `capability_hub_failed` | Authenticated transport, response validation, or Hub availability failed; local state remains authoritative. |

## Consequences

Skills, MCP integrations, provider plugins, and composed bundles share one supply-chain vocabulary while retaining distinct activation semantics. Projects and users can work entirely locally and selectively publish reusable packages. Exact agent and subagent bindings prevent capability drift, and telemetry continues to avoid unsupported use claims.
