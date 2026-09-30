# Event writer activation

Follow the [safety boundary](safety.md). Activation commands default to version 2. For version 3, include `--schema-version 3` on both plan and apply and meet all version 3 reader and evidence requirements.

- [Local-only activation](activation/local-only.md): reader upgrades, evidence, planning, apply, and verification.
- [Hub-enabled repository without a Node](activation/node-absent.md): when the local-only flow applies.
- [Hub-enabled activation](activation/hub-enabled.md): registered Node and Hub requirements, authoritative evidence, and apply checks.
