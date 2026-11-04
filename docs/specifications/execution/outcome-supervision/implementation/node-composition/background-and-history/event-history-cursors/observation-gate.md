# Observation gate

`SupervisionObservationGate` (`apps/node-runtime/src/supervision-observation-gate.ts`) wraps the standing supervision cycle ([ADR-0508](../../../../../../../decisions/operations/services/0508-observe-standing-supervision-only-when-its-source-can-differ.md)). `createNodeSupervisionWakeSchedule` composes it with the change loop, hints and deadlines.

A wake-up skips the full observation only when all of the following hold:

- The previous cycle returned `idle` or `blocked` without a report.
- No local or peer hint arrived after that cycle started.
- The event store head sequence and hash are unchanged.
- The input stamp is unchanged.
- No duty deadline has lapsed.
- The previous full observation is less than 900 seconds old.

A skipped wake-up returns the previous disposition without a report and runs `NodeSupervisionStore.auditHistory`. That method refuses to run beside an owner operation.

Duty deadlines are the cursor's next check, mandate expiry, the next peer audit and `SupervisionResultDelivery.nextRetryAt`. The same deadlines, with the history audit, set the loop's next wake-up.

The gate retains the future deadlines it knew when a cycle settled. Any retained deadline lapsing forces a full observation even if its source no longer reports it. This includes a startup-grace deferral that settles without a report: dropping its deadline once it lapses must not prevent the deferred evaluation from running.

The input stamp covers the files from `workforceSourcePaths`: the project manifest, `agents.json`, and every entry under the assignment, role, project capability and user capability trees. It records device, inode, mode, size, and nanosecond modification and change times. A missing path stamps as absent.

Inputs of more than 4,096 entries are not stamped. Neither are inputs whose paths cannot be resolved or read. In both cases every wake-up observes in full.

The gate keeps no durable state, records no event and grants no authority. A cycle failure or a hint during a cycle makes the next wake-up observe in full.

Tests cover the skip, each condition that forces observation, a hint during a cycle, the stamp bound, unreadable inputs, and shared reads of the role sources and retained-workspace evidence.
