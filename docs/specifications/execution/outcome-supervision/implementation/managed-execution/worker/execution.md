# Managed invocation and execution controls

## Effect and invocation

The optional `managedExecution` Node factory configuration selects the concrete `work.managed_execution.v1` effect adapter. The adapter reads the exact CAS effect, validates its hash and derived plan fields, and binds responsibility, lease, provider, instructions, risk, and token reservation. The effect represents one initial attempt and authorizes neither retry ancestry nor rework.

Under the owner fence, the adapter launches the configured Node executable and CLI bundle. A bounded private stdin envelope carries the invocation and configured provider executable. The owner token remains only in trusted process memory and stdin. Events retain no token, request body, or raw process output. The provider adapter creates the stored-login environment used by readiness inspection without inheriting API keys.

## Authority and execution controls

Before reservation, provider startup, every turn, and every write authorization, the child reobserves the canonical recorded decision, mandate, exact responsibility, assignment revision, live lease, and Git workspace. Changed instructions, invalid ownership, or a different workspace reject invocation. Unreviewed default capability packages reject execution. Supervised runs skip optional capability grounding, experimental linked selection, and semantic publication calls; these require separately admitted work.

During execution, the parent checks current authority every sixty seconds before renewing the owner lease. Before launch and after each successful check it also extends the executor's exact live assignment lease when that lease would expire within two minutes, recording `assignment.lease.renewed` under the owner fence for up to the responsibility's remaining completion window (at most five minutes); a lease that is not the run's exact live lease is never resurrected, no renewal occurs once the completion window cannot hold a fresh claim, and a renewal changes only the lease expiry, never the assignment revision that the responsibility binding pins. Each observation has a five-second deadline. An unavailable observation requests worker termination and retains an uncertain outcome; it cannot hold cancellation or the serial owner indefinitely. During runtime close, waiting for a pending authority observation is bounded by that observation's remaining window; process shutdown is separate. Late observation results cannot renew ownership after timeout, cancellation, or process closure. The child may observe renewal only for the same private token, owner, and generation. This read neither extends ownership nor revives a released token. Old commit coordinates remain invalid.

Process output is drained with a 1 MiB aggregate bound. Cancellation, deadline, overflow, or lost renewal makes the outcome uncertain. Killing the CLI does not prove descendant-process quiescence. A reservation and exact causal/request records prove dispatch, not successful execution. After the child exits, the parent confirms the managed effect only when the same run has one ordered adapter-stop and terminal pair. A child exit with a requested run but no reconciled termination remains uncertain, even when its exit code is zero. Partial records never grant automatic replay permission.

## Repository boundaries

Provider execution, target-file hashes, write permits, snapshots, and verification use the assigned workspace. Context preparation, injection, and document-freshness checks use the explicitly configured control repository. Each context load records that source repository's actual revision. The target repository cannot change during a managed context run. This prevents governance documents from being copied into user-owned worker files.
