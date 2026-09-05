# Repository migration

`lervo migrate capabilities` creates a read-only, content-bound plan. Apply promotes independently valid `.agents/skills/*` packages into immutable project capability packages without changing their content hash.

A standard Agent Skill containing only `SKILL.md` receives a synthesized `1.0.0`, unsigned/untrusted, all-role compatibility contract inside the installed package; its source directory remains byte-for-byte unchanged. `lervo init` performs this safe promotion automatically.

Existing Codex and Claude MCP or plugin configuration is observed as `unmanaged_provider_owned`. Lervo never copies possible credentials or silently translates provider semantics. MCP and plugin behavior enters managed execution only through a validated secret-free capability package and adapter activation receipt.
