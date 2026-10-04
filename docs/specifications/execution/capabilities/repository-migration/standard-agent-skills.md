# Standard Agent Skills

A standard Agent Skill containing only `SKILL.md` receives a synthesized unsigned/untrusted, all-role compatibility contract inside the installed package. Its source directory remains byte-for-byte unchanged. `lervo init` performs this safe promotion automatically.

Lervo owns the synthesized version. The first promotion is `1.0.0`. When the source matches an installed version, the plan reuses it as `unchanged`. After an edit, the plan creates the next patch version after the highest installed one. Installed versions stay immutable, and an edited loose skill never blocks `lervo upgrade` with `capability_conflict`. Skills with an authored `lervo-skill.json` or `lervo-capability.json` keep their declared version, so different bytes at that version still conflict.
