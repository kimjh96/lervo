# Authority and execution controls

## Invocation checks

Before reservation, provider startup, every turn, and every write authorization, the child reobserves the canonical recorded decision, mandate, exact responsibility, assignment revision, live lease, and Git workspace. Changed instructions, invalid ownership, or a different workspace reject invocation. Unreviewed default capability packages reject execution.

Supervised runs skip optional capability grounding, experimental linked selection, and semantic publication calls; these require separately admitted work.

## Authority and lease renewal

During execution, the parent checks current authority every sixty seconds before renewing the owner lease.

Before launch and after each successful check, the parent also extends the executor's exact live assignment lease if it would expire within two minutes. It records `assignment.lease.renewed` under the owner fence for up to the responsibility's remaining completion window, at most five minutes. Renewal:

- Never resurrects a lease other than the run's exact live lease.
- Stops once the completion window cannot hold a fresh claim.
- Changes only lease expiry, never the assignment revision pinned by the responsibility binding.

Each observation has a five-second deadline. An unavailable observation requests worker termination and retains an uncertain outcome; it cannot hold cancellation or the serial owner indefinitely.

During runtime close, waiting for a pending authority observation is bounded by that observation's remaining window; process shutdown is separate. Late observation results cannot renew ownership after timeout, cancellation, or process closure.

The child may observe renewal only for the same private token, owner, and generation. This read neither extends ownership nor revives a released token. Old commit coordinates remain invalid.

## Outcome evidence

Process output is drained with a 1 MiB aggregate bound. Cancellation, deadline, overflow, or lost renewal makes the outcome uncertain. Killing the CLI does not prove descendant-process quiescence.

A reservation and exact causal/request records prove dispatch, not successful execution. After the child exits, the parent confirms the managed effect only when the same run has one ordered adapter-stop and terminal pair. A child exit with a requested run but no reconciled termination remains uncertain, even when its exit code is zero. Partial records never grant automatic replay permission.
