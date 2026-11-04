# Instruction-capture review and evaluation

## Review and visibility

- The compact prompt includes capture upkeep in its cached health section. Full applied owner rules remain in the instruction preamble, as specified by the [operating attention contract](../../execution/operating-attention/report-contract.md#owner-turn-capture). Current byte and item limits are not established here; the former title-only, 600-byte description does not describe this contract.
- `lervo application attention` lists `durable_instruction_candidate` and `captured_decision` items. Instruction candidates belong to the instruction reviewer; held settled decisions belong to the principal proxy. Pending review alone makes neither owner-actionable. Both are nonblocking and contain normalized titles, never owner or agent turn text.
- `lervo knowledge instruction status` shows each candidate's source. The explicit review interface is `lervo knowledge instruction review <id> --decision apply|reject --reviewer <id> --approval <hash>`.
- `lervo knowledge instruction capture [--json]` shows queue depth (digests only), budget, and held items. `--dismiss <capture-id>` removes a held item.
- Rule materialization writes `docs/instructions/generated/<rule-id>.md`. Managed runs and Discord turns receive these files under `repository.instructions`; terminal instruction context includes the full applied rules. Capture and review do not authorize overwriting user-owned content.

Captured rules require exact review. This requirement does not imply that the owner must issue a review command for every rule. [ADR-0467](../../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) identifies [ADR-0545](../../../decisions/knowledge/documents/capture/0545-apply-owner-stated-rules-without-a-review-command.md) as its amendment under which owner-stated rules apply on the owner host without a review command. The amendment notice does not establish removal of exact review. Detailed automatic-application eligibility, review mechanics, and undo behavior require ADR-0545's exact contract and remain unverified here.

For the explicit review path, ADR-0467 binds review to the instruction-catalog digest: unrelated sources and events do not stale a candidate, while changes to `AGENTS.md` or entries in `docs/instructions/` block apply. On a Hub-coordinated host, apply requires the convergence ownership fence; a non-owner refuses with `convergence_owner_elsewhere` and names the owner. Rejection writes no repository bytes and may occur on any host. Without a Hub, the standalone path applies locally without the Hub publication commit. These explicit-path rules do not establish additional automatic-application behavior under ADR-0545.

The command forms above and the evaluation runner below are retained interface documentation. This document records no new command execution or installed validation.

## Evaluation

`benchmarks/grounding/instruction-capture-v1.json` contains 28 English and Korean cases covering explicit and paraphrased rules, implicit corrections with the agent turn they correct, decisions, personal preferences, and negatives.

`node scripts/evaluation/run-instruction-capture-evaluation.mjs --provider <claude|codex>` records one real-provider observation per case.

`pnpm evaluation:natural-language:check` requires:

- Class agreement of at least 0.8.
- Rule and correction recall of at least 0.85.
- No non-rule turn proposed as a canonical rule.
