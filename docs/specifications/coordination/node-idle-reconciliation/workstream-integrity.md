# Workstream integrity and capacity

## Verification and cache

The verified workstream cache contains database identity, event anchor, latest binding, verified ancestry, and audit time. It is rebuildable process memory only; validation failure clears it and reports existing `local_state_invalid`.

Each initial read and scheduled audit validates the event hash chain and all locally available current ancestry objects. Each newly encountered snapshot is read and hash-verified once by CAS, then checked against its schema, canonical JSON, and event binding. Every read checks the current projection and event anchor. Conflicting bindings for the same snapshot hash fail closed.

The process retains at most 4,096 recorded revisions and 32 MiB of verified snapshot bytes. Exceeding either limit discards the cache after returning the fully verified chain; no ancestry is omitted to satisfy a cache limit. Cached return values are detached from retained objects.

## Audit and detection window

A full audit is due after a stable repository-path-derived interval of 45–60 seconds and runs on the next chain read. Healthy idle scheduling limits detection to 85 seconds plus in-flight work; deferred synchronization may postpone it. Historical on-disk tampering can remain undetected within that window, though returned cached bytes retain their original verified content. Restart performs full validation. Database replacement requires reopening the runtime.

These detection semantics replace per-cycle historical disk verification. Unchanged head hashes alone do not attest current disk integrity.
