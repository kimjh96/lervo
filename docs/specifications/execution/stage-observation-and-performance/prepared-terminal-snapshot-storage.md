# Prepared terminal snapshot storage

`apps/cli/src/terminal-prepared-snapshot.ts` stores schema-version-1 repository snapshot coordinates under `.lervo/state/terminal-integration/prepared-snapshots`. Each record adds an observation ID to repository revision, file hashes, and optional commit coordinates. It stores no former file bodies; a digest cannot reconstruct pre-turn dirty bytes.

## Reads and validation

Snapshot filenames require an observation ID matching `tobs_` followed by one alphanumeric character and 7–63 alphanumeric, underscore, or hyphen characters. Reads require a regular, non-symlink leaf at most 8 MiB. Parsed records require:

- A SHA-256 revision.
- At most 20,000 file entries.
- Relative slash-separated paths without empty, dot, or parent components.
- SHA-256 file hashes.
- Optional commits naming existing file entries and containing 40–64 lowercase hexadecimal characters.
- A stored observation ID matching the requested coordinate.

Missing files return null. Other read, parse, safety, or validation errors propagate.

## Writes and retention

Writes create the state directory with requested mode 0700 and reject a final directory that is a symlink or not a directory. Serialized JSON plus a newline must fit within 8 MiB. A unique temporary file is exclusively created with requested mode 0600 and O_NOFOLLOW where available, written, synchronized, closed, and renamed to the observation filename. Rename can replace an existing record for that observation. Temporary cleanup runs in finally. The writer does not invoke the reader's structural validator before serialization.

After replacement, retention considers matching regular snapshot files, orders older modification times first with filename tie-breaking, prioritizes retaining the just-written filename, and removes excess entries above 64. Retention failure can propagate after replacement has occurred. This sequential procedure does not prove a concurrent global capacity bound.

## Safety and evidence boundaries

Leaf and final-directory checks do not independently verify every ancestor component or eliminate filesystem races. File synchronization and rename do not establish directory synchronization or power-loss durability. Hook fail-soft handling and snapshot publication ordering remain caller responsibilities.
