# Generic change planning limitations

`apps/node-runtime/src/conversation-repository-change.ts` converts source coordinates to byte digests:

- Missing coordinates become absence.
- Working-tree coordinates must match the regular-file digest form; links and special-file forms return `unsupported`.
- Git coordinates require a verified commit and a blob read with a 64 MiB output ceiling. Commit-verification failure and blob-buffer overflow return `unsupported`.
- After successful commit verification, other blob-read failures return absence. The helper therefore cannot distinguish every unreadable Git entry from a genuinely absent path.

Any unsupported before or after coordinate makes the entire planner return null.

For supported coordinates, the helper passes before and after revisions and digest maps to the repository change planner, retaining each Git before-coordinate's pinned commit. It stores the resulting manifest before completion and checks the returned CAS hash against the planned manifest hash. Generic change event identity is deterministically derived from the completion event ID.

These branches require focused review against the universal change-obligation contract: unsupported coordinates can suppress the generic job, and a blob-read error can become absence. The source alone establishes neither observed production loss nor an alternative recovery path.
