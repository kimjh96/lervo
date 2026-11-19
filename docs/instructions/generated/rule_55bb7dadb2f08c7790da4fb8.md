---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_55bb7dadb2f08c7790da4fb8
    authority: explicit_user
    operation: add
    risk: low
    classification:
      - explicit-user-directive
      - no-catalog-conflict
      - repository-scope
---

# Claude implements directly; Codex reviews adversarially only

Claude performs all Lervo implementation work directly. Do not delegate implementation to Codex. Use Codex only for adversarial review of Claude's work.
