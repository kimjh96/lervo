# ADR-0154: Multi-File Managed Provider Turns and Context Reinjection

- Status: accepted
- Decision date: 2026-08-22

## Context

One approval may cover multiple paths, but broad write authority in one turn obscures which permit applies and when repository changes invalidate E3. Mid-turn context injection is not a shared Codex/Claude contract.

## Decision

A managed plan uses 1–16 unique normalized approved paths in order. All target-turn IDs are generated and validated before storage/providers open. One provider session and bridge span the run, but each path gets one target turn, one provider turn, and a permit for only that path and exactly one verified change. Other paths, completed paths, and second writes fail.

Every turn retains the request plus its ordinal, relative target, and single-file instruction; this instruction grants no authority. The full approval is checked before provider start and the current path immediately before write.

Each verified file.changed invalidates current E3 as content_changed and increments generation. Before the next turn, a fresh snapshot must reconcile all accumulated managed evidence since the initial snapshot and contain no unmanaged change. Fresh E1/E2 then produces E3 for the new target turn. No running turn receives added context. Generations alternate injected 0..N-1 and invalidated 1..N without changing telemetry meanings.

Only the final turn's natural-language result becomes the run result artifact. Final snapshot reconciles every change before all project suites run. Later failure never auto-rolls back earlier verified changes; run.failed and evidence remain, remote execution closes execution_failed, and replay is forbidden.

Paths remain signed-policy/process-memory data; events retain only relative paths. Invalid scopes fail managed_approval_scope_invalid before storage. Invalid turn IDs, missing expected changes, and unmanaged changes use existing failure meanings.

## Consequences

Codex and Claude fixtures verify two paths in two turns, generations, path-order changes, per-path approval checks, final verification, duplicate rejection, lost-ack restart deduplication, and all single-file/failure regressions. Multi-file execution remains sequential and provider-neutral.
