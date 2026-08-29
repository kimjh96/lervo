# Managed linked-evidence canary v11 report

Status: `complete_with_activation_blocked`
Date: 2026-08-29

V11 completed all eight Codex and eight Claude task runs through native signed-in sessions. The context-forwarding correction preserved every deterministic linked selection through E1 planning, E2 loading, E3 injection, and E4 use. All 16 runs completed with source recall 1.0, zero selection calls, zero retries, and unchanged repository status digests.

Codex passed the unchanged accuracy gates. Claude completed every task and recalled every expected source but over-referenced non-expected sources: three of eight runs fell below the 0.5 per-run precision minimum, and mean precision was 0.5014 against the 0.65 provider minimum. V11 therefore does not authorize product activation.

## Bound evidence

- Prepared manifest digest: `sha256:c7e31ff9ba22a7e0516fa383c6705c092b4e3f288004771d7a6da874afa282bc`
- Observation-set digest: `sha256:5c45338a70bba8ce728dff0af0c7cc71fcbfe2ccaba5cfe823e613b4756b2f9d`
- Completed runs: 16 of 16
- Technical failures: 0
- Task provider calls: 16
- Selection provider calls: 0
- User API keys: 0
- Retries, repairs, and replacement runs: 0
- Repository mutations: 0

## Provider results

| Provider | Runs | Mean / median duration | Mean recall | Mean / minimum precision | Precision failures | Reported total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex `gpt-5.6-sol` | 8 | 139.035 / 148.817 s | 100% | 81.25% / 50% | 0 | 8,677,789 |
| Claude `opus` | 8 | 87.721 / 95.089 s | 100% | 50.14% / 22.22% | 3 | 1,372,999 |

Claude's mean duration was 36.91% lower than Codex's. Provider token accounting is not directly comparable and does not establish billed cost.

Against the reviewed two-stage ceiling, deterministic selection removed 16 of 16 selection calls and reduced total provider calls from 32 to 16. The defensible savings are 100% of selection calls and 50% of total provider calls. No monetary saving is claimed.

## Disposition

Preserve v11 as terminal evidence without retry. Keep the managed linked-evidence feature default-off. A successor may change the provider-neutral E4 reference constraint and prepare a fresh confirmation, but must not relax the 0.5 per-run or 0.65 per-provider precision gates.

## References

- [V11 forwarding decision](../../../decisions/search/activation/provider-shadow-structured/0290-forward-linked-selections-for-key-free-managed-canary-v11.md)
- [V10 terminal evidence](linked-evidence-managed-canary-v10.md)
- [Full Codex-Claude measurement report](../codex-claude-linked-evidence-measurement-report.md)
- [Managed canary specification](../../../specifications/execution/managed-linked-evidence-canary.md)
