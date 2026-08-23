# ADR-0104: CLI first-publication activation blocker report

Status: `accepted`
Decision date: 2026-08-21

## Context

The plan showed order/risk but not locally fixable versus externally verified blockers. Publisher readiness assumes a repository and steady-state settings and cannot decide unresolved repository/scope ownership for first publication.

## Decision

- Add `release:bootstrap:blockers [--json]`, reading only bounded regular CLI package and release-manifest files and rechecking unchanged bytes before output.
- V1 always states `blocked`, activation not implemented, advisory only.
- Local checks: package identity/public access; matching valid GitHub repository; matching non-UNLICENSED license; public npm registry plus explicit provenance. Each is ready/blocked with controlled reason. Only matching valid repository/license appear as targets.
- Bind both source digests and checks; reader reconstructs report, rejecting redigested forgery.
- Separately list `required` external facts: online public-name availability, human confirmation of real `@lervo` scope control, and separate approval binding license/name/scope/one-time publish/stage transition.
- `required` means unobserved, not failed/absent. Even all local-ready remains blocked because external facts and activation are outstanding.
- Default English output separates local changes from external confirmation; query exits 0 because report succeeded, so consumers inspect status.
- Reject unsupported/online arguments before source. Provide no online/approval/patch/reservation/publisher port. Bind metadata not changed and write no result/event/state.

## Consequences

Blockers are visible without selecting values or mutating metadata. ADR-0105 previews an explicit decision.
