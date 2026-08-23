# ADR-0153: Approval-Bound Managed Provider Node Host

- Status: accepted; extended by ADR-0154 for multiple files and ADR-0155 for roles
- Decision date: 2026-08-22

## Context

ADR-0152 left RemoteCommandExecutor external. Choosing an executor from a provider string would silently expand installed authority, while bypassing lervo run would weaken E1/E2/E3, one-use permits, snapshots, artifacts, and verification. Write paths must come from signed approval, never inferred from request text.

## Decision

@lervo/managed-provider-host implements the neutral executor by opening project storage and document registry, loading named suites before providers, and using ManagedProviderRunCoordinator with the same event store/CAS, PolicyManagedRunApprovalVerifier, developer role, filesystem.write=require_approval, and approved paths. Approval is checked before provider start and again immediately before each write. Existing E3, hash, unmanaged-change, result, and verification contracts remain authoritative.

One host runs one command at a time and closes storage before returning a receipt candidate. Provider output remains in local CAS; remote receipt contains only verified run ID and completion time. No writing-publication success is claimed.

remoteCommands.providerHost.providers is an explicit unique codex|claude allowlist of one or two. Only the installed CLI with this field assembles built-in factories. Unsupported provider/role fails before a session. The local capability intersection is filesystem read allowed, write requiring approval, shell allowed; Hub policy cannot relax write approval.

The evaluator passes approved repositoryPaths in process memory, but the coordinator revalidates the signed source. This initial version accepts exactly one normalized path; ADR-0154 expands to 1–16.

Host failures after receiver acceptance become terminal execution_failed and never auto-replay. Missing/expired/revoked approval remains pre-reservation approval_required. No new event or scheduler is added, and databases/receipts/output gain no request, provider output/error, secret, signature, diff, or absolute path.

## Consequences

Codex and Claude vertical fixtures verify signed-path writes, double approval checks, managed events and verification, redaction, lost-acknowledgement restart deduplication, provider start/stream/verification failures, pre-reservation approval rejection, provider allowlists, and preserved injection-based executors. Provider processes remain behind adapters; local-first operation remains Hub-free.
