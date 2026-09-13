# Decisions and artifacts

The journal stores exact plans and policy-review artifacts in CAS before appending `work.supervision.decision.recorded`. Contract hashes and CAS byte hashes have distinct meanings and are verified independently. Events contain hashes and bounded causal coordinates, never plan bodies, paths, provider output, or credentials.

A supplied review must match its hash, plan, mandate, source, graph, reviewer policy, admitted disposition, and deterministic decision ID. This consistency check grants no authority: the concrete effect adapter must independently verify the installed mandate and current admission.

Canonical event identity derives from the supervision scope, event type, and decision or receipt identity. Exact replay returns existing evidence; conflicting content rejects. Failed event publication leaves no decision claim. Unreferenced CAS objects follow the existing artifact retention lifecycle.

Effect observations require an existing decision. Confirmed receipts require later canonical project events, and the effect inspector must prove their exact effect identity. Existence and sequence alone do not establish success. Confirmation cannot be downgraded or replaced with different evidence. Uncertain observations never authorize replay.

Reads recover from the indexed supervision run in the canonical event store, including unresolved plans from earlier source revisions. There is no second task database or authorizing projection.

Each supervision journal admits at most 4,096 events. Reaching the bound stops new admission and requires an explicitly retained successor or compaction design; it never deletes evidence. Runtime idle cursors suppress unchanged cycles before journal replay.
