# Abandoned turns

A managed run whose owning Node instance dies after the provider session opened has no terminal event or usage receipt. The resource projection would hold its concurrency slot and refuse every later decision forever.

`lervo-node recover-abandoned-turn --config <config> --run-id <run> --unit <unit>` settles exactly this case under the owner lease. See the [assignment recovery entrypoint](../assignment-recovery.md) for ADR-0407.

The fence is a locally read unit invocation transition comprising:

- One invocation uniquely bracketing the run's events.
- A completed successor invocation.
- A distinct current invocation.

Invocations of one unit are sequential. Each owns the interval after its last log line until the next begins; a window adjoining its successor is valid, while an overlapping window is not.

The proof admits only a read-only adapter start with no observation proving work progress and no usage, stop, terminal or effect event. It writes `run.failed` with `failureCode: interrupted_after_turn_start` and `retryable: false` behind a `work.managed_abandoned_turn_failure` diagnostic that pins every original run event.

Readers treat the run as settled for concurrency and exclude it from the usage observation population while keeping its reservation charged, allowing the goal to continue without understating spend. The assignment returns through the ordinary reviewed rework path; this recovery never marks the turn safe to repeat.
