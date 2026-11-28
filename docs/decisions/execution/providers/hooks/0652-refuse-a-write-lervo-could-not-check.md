# ADR-0652: Refuse a write Lervo could not check

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md) (for claims and the turn's reconciliation only)
Related: [ADR-0645](0645-answer-an-unserved-prompt-from-the-cached-base.md), [Lervo ADE coordination](../../../../specifications/execution/product-surfaces/ade-coordination.md), [resident context socket](../../../../specifications/execution/stage-observation-and-performance/compact-terminal-context/resident-context-socket.md)

## Context

A claim decided whether a conversation's write may touch a path that another conversation holds. When Lervo could not decide, the write went ahead and the turn's end was meant to claim it:

- a decision longer than 2 seconds, or any failure, answered `defer`, which the provider treats as no decision;
- a launcher that no context server took exited 0 without loading the runtime;
- a reconciliation at `Stop` that did not finish within 3 seconds let the turn end.

On 2026-11-28 the real-repository canary on the Mac lervo checkout ran with 42.7 of 44 GB swap in use:

1. Conversation B wrote `docs/scratch/canary-a.md`, which conversation A had changed. No context server answered within 500 ms, so the launcher allowed the write unchecked.
2. B's `Stop` was served but took 8.1 seconds. Its reconciliation was abandoned, the turn ended unblocked, and no changes file, claim log entry, or event recorded anything.
3. Run in process afterwards, the same claim was refused and the same `Stop` blocked with the conflict.

The owner's rule ([rule_71ba2fb394f82b0827829cd2](../../../../instructions/generated/rule_71ba2fb394f82b0827829cd2.md)) is that Lervo never silently passes a check it could not finish.

## Decision

1. **An undecided claim is refused as unverified.** Past the decision deadline, or on any failure other than a refusal, the hook denies the write with the code `claim_unverified`. The message names the paths and the cause (such as `workforce_busy`, or `claim_deferred` for the deadline) and tells the agent that nothing was written and to retry. The claim log records it as a refusal with no holder, and the conversation shows it as stopped because Lervo could not check it in time.
2. **The decision deadline is 20 seconds, and the provider's claim hook timeout is 60.** The provider never reaches its own timeout, which would let the write go ahead.
3. **The launcher never answers a claim unchecked.** Launcher version 8 decides a claim in process when no server takes it. It does the same when a server that committed to the claim lost it, failed, or did not answer within 25 seconds. Other hooks keep their behavior.
4. **A `Stop` whose reconciliation could not finish blocks once.** Its reason says the turn's changes are unchecked and asks the agent to end the turn again. The second `Stop` reconciles again and lets the turn end. A failure outside a conversation blocks nothing. The reconciliation's own deadline is 6 seconds, below half the 15-second hook budget, past which a context server exits.

## Consequences

- A write in a conversation may wait up to 20 seconds on a slow host, and more when the launcher loads the runtime cold. Lervo's slowness now costs time instead of correctness.
- A Lervo failure that persists refuses every write in a conversation until it is fixed. The refusal names its cause, and the owner can close the repository's coordination gate.
- Worktrees started before this release keep their 10-second claim hook timeout until their conversation is restarted.
- The launcher stays within its 16 KiB bound: 16,318 bytes.
