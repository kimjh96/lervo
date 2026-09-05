# Reader and secret constraints

Readers accept at most 256 regular files and 16 MiB, follow no symlinks, reject path escape and read races, and exclude hidden or conventional credential, private-key, and secret filenames. Only native Codex and Claude plugin manifests may be hidden package files.

MCP manifests contain credential names, configuration references, and runtime-descriptor references, never credential values.
