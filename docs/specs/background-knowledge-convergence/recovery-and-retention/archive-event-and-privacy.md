# Archive event and privacy

Version 4 adds `assignment.convergence.archived` with required `assignmentId`, `assignmentRevision`, `assignmentHash`, `obligationId`, `terminalEventId`, `terminalEventHash`, `terminalStatus`, `archiveArtifactHash`, and `archivedAt`. IDs and hashes are bounded. `terminalStatus` is `completed`, `failed`, or `cancelled`. Unknown fields fail schema/privacy validation. Exact source bytes and paths stay in private CAS.

The event proves durable archival of one exact terminal assignment projection. It does not prove a failed result succeeded, remove a workspace, erase history, or grant retry authority. Missing terminal evidence, content drift, live consumers, or failed archival blocks removal without a success claim. Reader support and the reviewed writer transition remain prerequisites.
