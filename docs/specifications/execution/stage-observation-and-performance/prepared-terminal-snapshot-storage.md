# Prepared terminal snapshot storage

`apps/cli/src/terminal-prepared-snapshot.ts` stores repository snapshot coordinates in `.lervo/state/terminal-integration/prepared-snapshots`. A snapshot is the repository revision, file hashes, and optional commit coordinates. No former file bodies are stored; digests cannot reconstruct pre-turn dirty bytes.

Each observation has a small pointer, `<observation ID>.json`: schema version 2, the observation ID, and the content hash. The snapshot itself is stored once in `contents/sha256-<hex>.json`, named by the SHA-256 of its bytes. Consecutive prompts usually see the same files, so most prompts write only a pointer. Before this layout, each prompt wrote and synchronized the whole snapshot, about 2.3 MB for this repository, and 64 retained copies took about 140 MB. A schema-version-1 record, which holds the snapshot and the observation ID in one file, is still read.

## Reads and validation

Snapshot filenames require an observation ID matching `tobs_` followed by one alphanumeric character and 7–63 alphanumeric, underscore, or hyphen characters. Reads require a regular, non-symlink leaf no larger than 8 MiB. Parsed records require:

- A SHA-256 revision.
- At most 20,000 file entries.
- Relative slash-separated paths with no empty, dot, or parent components.
- SHA-256 file hashes.
- Optional commits naming existing file entries and containing 40–64 lowercase hexadecimal characters.
- A stored observation ID matching the requested coordinate.

A pointer requires a matching observation ID and a SHA-256 content hash, and its content file must hash to that value; content whose bytes changed is rejected. Missing files, including a pointer's missing content, return null. All other read, parse, safety, and validation errors propagate.

## Writes and retention

Writes create the state and content directories with requested mode 0700 and reject a final directory that is a symlink or not a directory. Serialized JSON plus a newline must fit within 8 MiB. The content file is written only when no regular file with its name exists. Each file is written through a unique temporary file, exclusively created with requested mode 0600 and O_NOFOLLOW where available, then written, synchronized, closed, and renamed. Rename may replace an existing pointer for that observation. Temporary cleanup runs in finally. The writer does not invoke the reader's structural validator before serialization.

After the pointer is written, retention considers pointer and schema-version-1 files, orders them by older modification time first with filename tie-breaking, prioritizes retaining the just-written filename, and removes excess entries above 64. It then removes content files that no retained pointer names and that were last modified at least a minute ago; a younger one may belong to a concurrent writer whose pointer is not yet written. Retention failure may propagate after the pointer has been written. This sequential procedure does not prove a concurrent global capacity bound.

## Safety and evidence boundaries

Leaf and final-directory checks do not independently verify every ancestor component or eliminate filesystem races. File synchronization and rename do not establish directory synchronization or power-loss durability. Hook fail-soft handling and snapshot publication ordering remain caller responsibilities.
