# Portable-skill authorization

A development-pattern portable-skill candidate includes reviewed `lervo-skill.json` and `lervo-capability.json` contracts. Promotion leaves the skill untrusted and disabled.

`lervo capability authorize-skill --skill <skill-id> --reviewer <id> --json` creates a content- and manifest-bound project authorization plan. Apply requires the saved plan and exact plan ID. Only then may migration preserve and install the candidate's capability ID, permissions, discovery metadata, and exact dependency coordinates.

Authorization does not migrate, select, activate, invoke, or verify the package.
