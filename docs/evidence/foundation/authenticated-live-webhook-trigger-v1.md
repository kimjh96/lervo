# Authenticated live webhook trigger v1

Status: `passed`

Observed: 2026-09-07

## Outcome

The installed CLI accepts an exact HMAC-authenticated webhook event, checks repository-owned authority and cumulative budget, reserves it durably, and materializes the fixed assignment routine. Exact replay returns current completion without creating a duplicate assignment.

## Verified boundaries

- Adapter tests cover exact signed bytes, time bounds, loopback transport, secret clearing, and rejection without retaining raw bodies or native event IDs.
- SQLite tests cover atomic reservation, in-progress handling, changed-input conflict, explicit recovery, cumulative budgets that survive pruning, and bounded completion retention.
- CLI tests prove an authenticated HTTP request creates one assignment and exact replay stays at one; public routine JSON cannot forge authenticated-live authority.
- The packed installed consumer repeats the signed HTTP and assignment-list journey through `@lervo/cli` alone.

## Claim boundary

This proves the installed webhook adapter and shared live-trigger contracts. It does not prove unattended scheduling, service supervision, provider execution, automatic assignment claiming, cron/API/platform-specific adapters, approval authority, or dynamic graph topology.

## Regression

- `pnpm exec vitest run packages/adapter-webhook/test/adapter-webhook.test.ts packages/live-trigger-sqlite/test/live-trigger-store.test.ts apps/cli/test/assignment-routine-command.test.ts apps/cli/test/live-trigger-command.test.ts`
- `pnpm smoke:packed-cli`
- `pnpm quality:check`
- `pnpm docs:check`
- `lervo migrate knowledge`
- `lervo knowledge lint`
