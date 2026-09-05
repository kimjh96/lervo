# Repository migration

`lervo migrate capabilities` creates a read-only plan bound to both the executable content hash and the complete package-byte hash. Apply promotes independently valid `.agents/skills/*` packages into immutable project capability packages without changing their content hash. A manifest-only change invalidates the plan and conflicts with an occupied immutable version coordinate.

A standard Agent Skill containing only `SKILL.md` receives a synthesized `1.0.0`, unsigned/untrusted, all-role compatibility contract inside the installed package; its source directory remains byte-for-byte unchanged. `lervo init` performs this safe promotion automatically.

A development-pattern portable-skill candidate includes reviewed `lervo-skill.json` and `lervo-capability.json` contracts. Promotion leaves the skill untrusted and disabled. `lervo capability authorize-skill --skill <skill-id> --reviewer <id> --json` creates a content- and manifest-bound project authorization plan; apply requires the saved plan and exact plan ID. Only then may migration preserve and install the candidate's capability ID, permissions, discovery metadata, and exact dependency coordinates. Authorization does not migrate, select, activate, invoke, or verify the package.

Existing Codex and Claude MCP or plugin configuration is observed as `unmanaged_provider_owned`. Lervo never copies possible credentials or silently translates provider semantics. MCP and plugin behavior enters managed execution only through a validated secret-free capability package and adapter activation receipt.
