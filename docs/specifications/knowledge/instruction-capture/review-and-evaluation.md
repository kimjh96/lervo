# Instruction-capture review and evaluation

## Review and visibility

- The compact prompt shows `Instruction capture: …` while candidates or held items exist, and `Applied owner rules (follow them; …): <titles>` while generated rules exist. Each line is at most 600 bytes and lists normalized titles only.
- `lervo application attention` lists `durable_instruction_candidate` and `captured_decision` items.
- `lervo knowledge instruction status` shows each candidate's source. `lervo knowledge instruction review <id> --decision apply|reject --reviewer <id> --approval <hash>` applies or rejects it.
- `lervo knowledge instruction capture [--json]` shows queue depth (digests only), budget, and held items. `--dismiss <capture-id>` removes a held item.
- Apply writes only `docs/instructions/generated/<rule-id>.md`. Managed runs and Discord turns receive these files under `repository.instructions`; terminal agents see their titles in every compact prompt.

Captured rules are never applied without exact review. [ADR-0467](../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) records the rationale and requirements for an automatic-apply amendment.

## Evaluation

`benchmarks/grounding/instruction-capture-v1.json` contains 28 English and Korean cases covering explicit and paraphrased rules, implicit corrections with the agent turn they correct, decisions, personal preferences, and negatives.

`node scripts/evaluation/run-instruction-capture-evaluation.mjs --provider <claude|codex>` records one real-provider observation per case.

`pnpm evaluation:natural-language:check` requires:

- Class agreement of at least 0.8.
- Rule and correction recall of at least 0.85.
- No non-rule turn proposed as a canonical rule.
