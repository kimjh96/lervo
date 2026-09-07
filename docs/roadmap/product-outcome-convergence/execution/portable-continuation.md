# Portable attach, detach, and resume

State: `implemented`

Outcome: long-running assignments attach, detach, and resume through repository-owned state without provider conversation memory.

Evidence: Worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Installed cross-provider continuation proves this portable boundary without claiming restored conversation memory.

Preserve repository-level continuation as the portable contract.
