# ADR-0154: Multi-File Managed Provider Turns and Context Reinjection

- Status: accepted
- Decision date: 2026-08-22

## Context

One approval may cover multiple paths, but broad write authority within one turn obscures which permit applies and when repository changes invalidate E3. Mid-turn context injection is not a shared Codex/Claude contract.

## Decision

A managed plan contains 1–16 unique, normalized approved paths in order. Generate and validate every target-turn ID before opening storage or providers. One provider session and bridge span the run, but each path receives one target turn, one provider turn, and one permit authorizing only that path and exactly one verified change. Writes to other or completed paths and second writes fail.

Each turn retains the request, ordinal, relative target, and single-file instruction; the instruction grants no authority. Check the full approval before provider start and the current path immediately before its write.

Each verified `file.changed` invalidates current E3 as `content_changed` and increments generation. Before the next turn, a fresh snapshot must reconcile all accumulated managed evidence since the initial snapshot and contain no unmanaged change. Fresh E1/E2 then produces E3 for the new target turn. Never add context to a running turn. Generations alternate injected `0..N-1` and invalidated `1..N` without changing telemetry meanings.

Only the final turn's natural-language result becomes the run result artifact. The final snapshot reconciles every change before all project suites run. Later failure never automatically rolls back earlier verified changes; `run.failed` and evidence remain, remote execution closes as `execution_failed`, and replay is forbidden.

Paths remain signed-policy and process-memory data; events contain only relative paths. Invalid scopes fail `managed_approval_scope_invalid` before storage. Invalid turn IDs, missing expected changes, and unmanaged changes retain existing failure meanings.

## Consequences

Codex and Claude fixtures verify two paths across two turns, generations, path-order changes, per-path approval checks, final verification, duplicate rejection, lost-ack restart deduplication, and all single-file and failure regressions. Multi-file execution remains sequential and provider-neutral.
