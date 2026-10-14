# ADR-0519: Give new evaluation logic one attempt on exhausted assignments

Status: `accepted`
Decision date: 2026-10-14
Amends: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)

## Context

ADR-0485 reevaluates each settled stall once after logic changes: the stage is requeued under the new evaluation contract. The requeued stage gets a fresh delivery. Its convergence assignment, however, keeps its attempt count. When that assignment has used all 16 attempts, `retryConvergenceAssignment` refuses it at once.

flemo's canonical integration used all 16 attempts by 2026-10-13. Each attempt failed with `knowledge_verification_modified_sources`. The host's pnpm 11.18.0 switched itself to flemo's `pnpm@12.9.1`, and the switch wrote `@pnpm/exe` into `pnpm-lock.yaml`. Three deploys of new logic each requeued the stage, at 19:43, 00:31 and 07:49 UTC. Each ended `knowledge_retry_exhausted` within a second, before any attempt ran. Once the host's pnpm was fixed, nothing could run the integration again short of a source change.

## Decision

- The assignment failure receipt records the evaluation contract that judged the failure.
- An assignment that used its 16 attempts is reopened once more only when its last failure was judged under an earlier evaluation contract or none. A receipt written before this decision has no contract and counts as earlier.
- The extra attempt records the current contract when it fails, so the assignment stays exhausted until another logic deploy.

## Consequences

A deploy of new logic actually reattempts an exhausted assignment once, as ADR-0485 intended. The loop guard still holds: at most one extra attempt per deploy of new logic.

No event type or state is added. The private failure receipt gains `evaluationContract`, a code identity with no repository content.

## Verification

Unit tests cover both cases at the attempt limit:

- an assignment whose last failure the current logic judged stays exhausted;
- an assignment whose last failure earlier logic judged, or no logic recorded, gets past the limit.
