# Upgrade exclusion and foreground waits

[ADR-0484](../../../../../decisions/operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) keeps `lervo upgrade --apply` exclusive with background knowledge work. The apply holds the resident's host-wide full-cycle admission from the approval check to its last stage. A repository knowledge scan retries up to three times when the revision or a file moves under it.

Foreground commands distinguish live materialization owners from interrupted ones:

- `lervo upgrade`, `lervo knowledge` subcommands other than `worker` and `convergence`, `lervo migrate knowledge`, `lervo state`, `lervo terminal status`, and `lervo terminal declare` wait while another running process owns the marker. They poll every 2 seconds, with at most 15 minutes for the whole command, and print one stderr notice per owner.
- Terminal hooks and attention inspection wait at most 10 seconds because provider hooks have a 30-second timeout.
- An expired wait fails with `knowledge_materialization_wait_expired`, names the owner process, plan, and phase, and leaves the marker unchanged.
- An interrupted marker fails immediately with `knowledge_recovery_required` and names `lervo knowledge materialize --recover`.
