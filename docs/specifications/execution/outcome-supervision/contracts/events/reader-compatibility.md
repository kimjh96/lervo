# Reader compatibility

Every stored event must satisfy a readable event schema of the reader opening the store. CLI, Node, and Hub bundles built before envelope-version-3 `work.supervision.readiness.failed` reject journals containing it with `integrity_failed` (`The stored event does not satisfy a readable event schema.`). Hub replication stops at the preceding sequence.

Before an installed owner can record this event, deploy the managed CLI bundle, Node bundle, and Hub from one revision that knows it. A mixed deployment is a non-start, not data loss.

## Owner interruption reconciliation

The same reader-first rule applies to `work.supervision.owner_reasoning.interruption_reconciled`: old readers reject it. Deploy compatible CLI, Hub, and Node readers before an explicit repair writes it.

Its CAS diagnostic pins every run event and a fresh host unit-invocation witness. No prompt, output, path, source bytes, or token estimate enters the event. See [ADR-0430](../events.md#references).

When the concrete owner-reasoning inspector proves that exact reconciliation and failed run, `work.supervision.effect.observed` may confirm only the invocation's settled terminal state, not a successful owner result. The decision journal additionally requires the reconciliation's deterministic ID, matching decision coordinates, and the exact earlier `provider_stop_failed` terminal as its second cause. An unrelated supervision event cannot confirm a decision.
