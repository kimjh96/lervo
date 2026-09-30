# Execution budgets and evidence

## Managed execution budget

The stored policy must declare its managed execution budget. The installed architecture policy permits at most:

- 32 provider calls.
- 500,000 exact observed total tokens; unavailable token evidence blocks execution.
- 1,800,000 elapsed milliseconds.

With four reviewers, two rounds, one revision, one verification, and one decision, the no-repair baseline is 24 calls, including independent semantic evaluation. The remaining eight calls allow four bounded writing repairs and their evaluations; configuration no longer sets the ceiling equal to the best-case baseline. Execution-plan construction rejects a policy whose call ceiling cannot complete the no-repair baseline.

The worker derives a smaller managed ceiling from `processTimeoutMs`. This policy requires `processTimeoutMs` of at least 1,860,000 milliseconds to preserve the worker's 60,000-millisecond terminalization reserve.

The managed runner separately reserves the final portion of its elapsed ceiling for stream drain, provider stop, repository inspection, failure recording, storage close, and summary serialization.

Reaching a limit records an exact terminal reason. Discord distinguishes budget exhaustion from participant-binding invalidity, states that partial work was not adopted, and does not automatically repeat the same execution.

## Repository evidence

Before the first provider call, the worker queries current repository knowledge using the complete human topic, verifies every selected publication against its exact content hash, and installs a bounded immutable evidence bundle in the deliberation workspace. Every decision stakeholder receives the same bundle.

If no current publication is available or any selected byte changes, deliberation records a terminal failure and spends no provider call. Provider tools are not a retrieval fallback.
