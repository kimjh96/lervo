# Instruction-capture visibility and evaluation

## Visibility

- The compact prompt includes capture upkeep in its cached health section. Full applied owner rules remain in the instruction preamble, as specified by the [operating attention contract](../../execution/operating-attention/report-contract.md#owner-turn-capture).
- `lervo application attention` lists `durable_instruction_candidate` (`pending_apply`) and `captured_decision` (`lervo_debt`) items. Neither requires owner action.
- `lervo knowledge instruction status` shows each stored candidate and its source. `lervo knowledge instruction retire <rule-id>` undoes an applied rule.
- `lervo knowledge instruction capture [--json]` shows queue depth (digests only), retained records, budget, and held items. `--dismiss <capture-id>` removes a held item.
- Apply writes `docs/instructions/generated/<rule-id>.md` and deletes only generated rules that the new rule replaces. Managed runs and Discord turns receive these files under `repository.instructions`; terminal instruction context includes the full applied rules.

Captured rules are applied after an independent cross-check agrees, without owner review ([ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

## Evaluation

`benchmarks/grounding/instruction-capture-v1.json` contains 28 English and Korean cases covering explicit and paraphrased rules, implicit corrections with the agent turn they correct, decisions, personal preferences, and negatives.

`node scripts/evaluation/run-instruction-capture-evaluation.mjs --provider <claude|codex>` records one real-provider observation per case.

`pnpm evaluation:natural-language:check` requires:

- Class agreement of at least 0.8.
- Rule and correction recall of at least 0.85.
- No non-rule turn proposed as a canonical rule.
