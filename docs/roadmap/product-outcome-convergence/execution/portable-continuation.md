# Portable attach, detach, and resume

State: `implemented`

Long-running assignments attach, detach, and resume through repository-owned state without provider conversation memory. Repository-level continuation remains the portable contract.

Worker Stop records an exact scoped checkpoint, pauses and releases its writer, and permits a fresh verified terminal session to resume the same assignment. Installed cross-provider continuation proves this portable boundary without claiming restored conversation memory.
