# Portable-skill authorization

A development-pattern portable-skill candidate includes reviewed `lervo-skill.json` and `lervo-capability.json` contracts. Promotion leaves the skill untrusted and disabled.

`lervo capability authorize-skill --skill <skill-id> --reviewer <id> --json` creates a content- and manifest-bound project authorization plan. Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), `--apply` with `--skill` and `--reviewer` plans and applies in one run, and `--from <plan-json> --apply` applies a saved plan that still matches the skill; no plan ID is echoed. The manifest is backed up first, and `lervo state restore <backup-id>` undoes the authorization. Only after authorization may migration preserve and install the candidate's capability ID, permissions, discovery metadata, and exact dependency coordinates.

Authorization does not migrate, select, activate, invoke, or verify the package.
