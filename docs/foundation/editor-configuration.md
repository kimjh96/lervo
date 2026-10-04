# Editor configuration

The repository-root `.editorconfig` defines editor defaults for repository files. `root = true` stops EditorConfig lookup in parent directories.

The `[*]` section selects UTF-8 encoding, LF line endings, spaces, and two-space indentation. It requests a final newline and removal of trailing whitespace.

The `[*.md]` section sets trailing-whitespace removal to `false`. Editors following this configuration preserve Markdown trailing spaces; all other defaults still apply.

These settings do not establish that every file conforms or every editor honors EditorConfig. The [code convention](code-convention.md) defines formatting ownership and automated checks. [ADR-0215](../decisions/release/packaging/0215-supported-runtime-release-portability.md) documents Git text classification and checkout line endings.
