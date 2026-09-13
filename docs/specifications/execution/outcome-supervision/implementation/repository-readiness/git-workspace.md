# Git workspace

Exactly one nonremoved workspace must belong to the assignment and match its assignee, lease generation, and repository instance. Only worker workspaces in ready, paused, or active state qualify. Ready and paused workspaces must have no writer. An active workspace's writer must match the assignment lease session. Recovery state, unknown native identity, unsupported host versions, or missing owner paths reject observation.

The existing Git host adapter inspects the recorded path, exact ownership marker, native instance, reachable base, in-progress Git operations, and base-relative changed paths. Changes outside the assignment's path scope reject readiness. After inspection, the canonical workspace record must be reread and unchanged.

Each inspection reads the current commit, tree, and absolute Git directory together. Git operation markers and workspace ownership use that observed directory. A fresh clean status with the current commit equal to the exact inspection base proves an empty base-relative change set. Dirty or advanced checkouts retain complete tracked-diff and untracked-file enumeration. Inspection results and repository coordinates must not be cached.

Observation is read-only: it performs no provisioning, writer activation, cleanup, or Git mutation. Only the current Git host adapter is composed here; Orca and other unsupported host observations remain unavailable. The adapter cannot observe or claim Git process quiescence. Application evidence remains responsible for process and tool readiness and any stronger host admission.

[Supervised workspace preparation](../workspace-preparation.md) owns the separate admitted provisioning effect and trusted host configuration.
