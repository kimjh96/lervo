# ADR-0492: Install and verify Node runtime dependency closures

- Status: accepted
- Decision date: 2026-10-07

## Context

On 2026-10-07, the installed digimon Node accepted a message but failed before Claude startup. The fleet installer had copied bundled JavaScript and the launcher without the external Claude Agent SDK. Service and Gateway health remained ready. The isolated smoke check tested only invalid arguments and never imported the missing package.

## Decision

A fleet runtime includes the bundled payload, launcher, and a self-contained external SDK dependency graph. Resolve the graph from the running CLI installation, including required dependencies, peers, installed optional packages, and the host's SDK native package. Preserve distinct nested versions and pnpm resolution through internal package links. No installed link may depend on the source checkout or original CLI installation.

Runtime identity hashes payload bytes and the dependency manifest hash. The manifest contains schema version 1, package names and versions, relative file paths, SHA-256 digests, executable flags, and dependency graph indices. It excludes absolute source paths, credentials, prompts, and provider output. It is installation material, not a new execution event or canonical repository knowledge. Limit the graph to 512 packages, 32,768 files, and 512 MiB. Retain installed manifests within the existing content-addressed runtime lifecycle, without new per-run history.

Materialization must:

- Create files exclusively and verify source bytes against planned digests.
- Preserve native executable permissions and create only internal dependency links.
- Verify the installed graph before returning an executable for service activation.

Missing generated files are repairable. Different bytes, unsafe files or directories, and redirected links fail with the existing `node_fleet_executable_invalid` meaning and are never silently overwritten.

Upgrade inspection verifies dependency content and links before any `exact_runtime_ready` disposition. `node_runtime_dependencies_missing` is a `safe_apply` stage requiring the existing guarded replacement path. `node_runtime_dependency_conflict` is blocked and authorizes no replacement. Both retain existing Node stage fields and the privacy contract. Replica runtime pointers use the same payload-and-dependency identity as fleet installation.

Node startup and `--check-config` import the external SDK before opening application services. `runtime_dependency_unavailable` means installed SDK material is absent or incompatible; it does not establish login, provider capacity, or remote availability. The error carries only its fixed code and public message, without a native import cause or installation path. Import preflight starts no provider and sends no network request.

## Verification

Regression cases cover npm and pnpm layouts, peer and nested dependency versions, source-installation removal, missing-file repair, content changes, stale source bytes, required dependency absence, native executable permissions, redirected links, and exact live deployments with absent dependencies.

Built-runtime acceptance must load the copied SDK from an isolated installed runtime and prove SDK initialization separately from Gateway readiness. Provider response and Discord delivery remain separate observations.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Bounded repository upgrade orchestration](0214-bounded-repository-upgrade-orchestration.md)
- [Repository Node fleet acceptance](../../../roadmap/coordination/repository-node-fleet/fleet.md)
