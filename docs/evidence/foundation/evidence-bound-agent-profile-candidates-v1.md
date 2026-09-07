# Evidence-bound agent-profile candidates v1

Status: `passed`

Observed: 2026-09-06

## Outcome

Lervo exposes `role candidate propose|status|review|activate|rollback` over the existing immutable development-pattern lifecycle. Candidates require at least two independent managed role-activation and passed-verification pairs for one exact source role contract. Exact review and activation create or replace one deterministic user-owned repository-role source. Explicit rollback deletes the created role or restores its exact predecessor.

Effect observation reuses the existing baseline and treatment protocol, retains `attribution=unestablished`, and grants no rollback authority.

Packed consumer witness: `run_5dcac598152945ee9823ac7a9b1b7b2e`. Each regression uses a fresh temporary repository; this run identifies the current observation, not a stable fixture coordinate.

## Verified boundaries

- Repository-knowledge tests cover exact evidence validation, changed-evidence rejection, new-profile activation and deletion, versioned replacement, and exact predecessor restoration.
- CLI tests cover candidate creation, exact review, activation, role resolution, baseline registration, treatment observation, explicit rollback, and current projection rebuilding.
- Managed-run tests cover `role.profile.activated` emission for both Codex and Claude.
- Schema and redaction tests cover schema-v2 compatibility and the bounded event allowlist.
- The packed CLI journey derives a profile candidate from installed managed runs, activates it, validates exact role resolution, and rolls it back.

## Claim boundary

These checks prove exact event and file contracts, transactional lifecycle behavior, provider-neutral orchestration, and installed CLI consumption. They do not prove model attention, understanding, semantic reliance, causal improvement, provider-native memory, live provider quality, or automatic profile authority.

## Regression

- `pnpm exec vitest run packages/repository-knowledge/test/agent-profile-pattern.test.ts packages/event-contract/test/redaction.test.ts packages/schemas/test/event-compatibility.test.ts apps/cli/test/managed-run.test.ts apps/cli/test/agent-profile-candidate.test.ts`
- `pnpm smoke:packed-cli`
- `pnpm quality:check`
- `pnpm docs:check`
- `lervo migrate knowledge`
- `lervo knowledge lint`
