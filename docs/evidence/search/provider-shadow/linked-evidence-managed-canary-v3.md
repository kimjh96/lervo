# Managed-context canary v3 preparation rejection

Status: `rejected_before_execution`
Date: 2026-08-29

## Result

The API-key-free V3 checkpoint was prepared and replayed exactly with manifest `sha256:b93952d09b44e77223cd5b217480e0af1dda748ae548d0dc65ca1e3717dbf0cc`. It retained 16 paired task runs, zero selection calls, a 16-task-call ceiling, zero provider calls, false execution and managed-context-effect authority, and mode `0600`.

Every source manifest, passed V18 review, observation file, candidate envelope, selected version, provider, model, and current projection matched. Validation exposed a population mismatch: V18 provider selections mainly chose documents already present in ordinary lexical or graph context. Projection onto the additional managed linked-candidate set retained no source in any of eight Codex runs and one source in one of eight Claude runs.

| Provider | Runs | Current linked candidates | Retained additions | Runs with an addition |
| -------- | ---: | ------------------------: | -----------------: | --------------------: |
| Codex | 8 | 32 | 0 | 0 |
| Claude | 8 | 32 | 1 | 1 |

V3 was rejected before execution because it would not measure a comparable managed linked-context effect. No provider call, task turn, selection turn, context injection, write, external message, Hub effect, direct-terminal effect, operational-search change, or production effect occurred. The prepared owner-only record is preserved and must not be authorized, resumed, retried, repaired, or used as a performance sample.

## Disposition

A successor may retain the zero-selection-call and native-session design, but must bind a provider-neutral deterministic rule that produces nonempty exact linked selections in every paired run. Provider-specific V18 selections remain quality evidence for the relational selection protocol but are unsuitable as added-context selections for this population.

## References

- [API-key-free V3 decision](../../../decisions/search/activation/provider-shadow-structured/0282-remove-api-key-requirement-from-managed-context-canary.md)
- [V18 selection evidence](linked-evidence-provider-shadow-pilot-v18.md)
- [Measurement report](../codex-claude-linked-evidence-measurement-report.md)
