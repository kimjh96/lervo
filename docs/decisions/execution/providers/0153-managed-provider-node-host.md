# ADR-0153: Approval-Bound Managed Provider Node Host

- Status: accepted; extended by ADR-0154 for multiple files and ADR-0155 for roles
- Decision date: 2026-08-22

## Context

ADR-0152 left `RemoteCommandExecutor` external. Selecting an executor from a provider string would silently expand installed authority; bypassing `lervo run` would weaken E1/E2/E3, one-use permits, snapshots, artifacts, and verification. Signed approval—not request text—must define write paths.

## Decision

`@lervo/managed-provider-host` implements the neutral executor. It opens project storage and the document registry, loads named suites before providers, and uses `ManagedProviderRunCoordinator` with the same event store/CAS, `PolicyManagedRunApprovalVerifier`, developer role, `filesystem.write=require_approval`, and approved paths. Approval is checked before provider start and immediately before every write. Existing E3, hash, unmanaged-change, result, and verification contracts remain authoritative.

One host executes one command at a time and closes storage before returning a receipt candidate. Provider output stays in local CAS. The remote receipt contains only verified run ID and completion time and claims no writing-publication success.

`remoteCommands.providerHost.providers` is an explicit, unique `codex|claude` allowlist of one or two entries. Only the installed CLI with this field assembles built-in factories. Optional `providerHost.executables` binds allowlisted providers to safe absolute executable paths so supervised runtimes do not depend on an interactive shell's `PATH`. Executable selection remains inside the provider adapter boundary. Unsupported providers, executable keys, or roles fail before session creation. The local capability intersection permits filesystem reads and shell, requires approval for writes, and cannot be relaxed by Hub policy.

The evaluator passes approved `repositoryPaths` in process memory, but the coordinator revalidates the signed source. This version accepts exactly one normalized path; ADR-0154 expands the range to 1–16.

Host failures after receiver acceptance become terminal `execution_failed` and are never automatically replayed. Missing, expired, or revoked approval remains pre-reservation `approval_required`. Add no event or scheduler. Add no request, provider output/error, secret, signature, diff, or absolute path to databases, receipts, or output.

## Consequences

Codex and Claude vertical fixtures verify signed-path writes, double approval checks, managed events and verification, redaction, lost-acknowledgement restart deduplication, provider start/stream/verification failures, pre-reservation approval rejection, provider allowlists, and preserved injection-based executors. Provider processes remain behind adapters; local-first operation remains Hub-free.
