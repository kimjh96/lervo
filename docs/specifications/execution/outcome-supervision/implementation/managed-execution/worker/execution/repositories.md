# Repository boundaries

Provider execution, target-file hashes, write permits, snapshots, and verification use the assigned workspace.

Context preparation, injection, and document-freshness checks use the explicitly configured control repository. Each context load records that source repository's actual revision.

The target repository cannot change during a managed context run. This prevents governance documents from being copied into user-owned worker files.
