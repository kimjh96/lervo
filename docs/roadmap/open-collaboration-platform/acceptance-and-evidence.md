# Open collaboration acceptance and evidence

## Acceptance metrics

Report weekly from ADR-0459 projections, per channel and agent:

- Retrieval: hit precision at least 0.7 on conversation and supervision channels; miss rate below 0.1; stale-hit rate below 0.02.
- Efficiency: tokens per successful outcome trend down over four weeks for one standing goal; no supervised run exceeds its reservation in flight.
- Conversation: duplicate human-turn answers below 5 percent; exchange budget exhaustion visible every time.
- Knowledge: at least 90 percent of per-change jobs reach `current`; zero generated review sources.
- Replicas: at most one attention item per divergence identity; zero silent repeats.
- Proxy settlements: 100 percent within mandate scope, each with a recorded decision event.
- Deliberation: Tier 0 rate of 100 percent on `adr_authoring` points; `outcomeChangeRate` above zero for Tier 1 and 2; zero `unverified` artifacts counted toward convergence; `laterDefectRate` reported with and without deliberation; Tier 0 cost at most 24,000 tokens per run.
- Document freshness: p90 time to a verified candidate under 30 minutes for `safety` and `entrypoint` findings; false-positive rate below 10 percent; acceptance rate above 70 percent; tokens per applied update at most 40,000; revert rate below 5 percent; no stale entrypoint older than one escalation batch window without an open candidate or owner question.

## Relabeling applied in this change

Under ADR-0452 section 5, these entries moved from `implemented` to `wired` because their evidence uses packed temporary consumers or fixture providers:

- Every [Prime-Agent-derived execution outcome](../product-outcome-convergence/execution.md) except provider-native resume.
- Every [repository knowledge outcome](../product-outcome-convergence/repository-knowledge.md).
- Dynamic execution graphs, replaceable components, and separately installed hosts in [host-product outcomes](../product-outcome-convergence/host-products.md). ADR-0560 removed the reviewed local and authenticated live trigger and Slack outcomes.

Guild `/goal` intake and the supervision token ceiling retain installed evidence and the label `installed-proven`. The multi-party conversation entry replaces the undefined `installed acceptance required` with `delivery required`.

## Corrections to the diagnosis

Verification corrected these premises:

- "Tarin" is a deployment identity, not a code mapping.
- `waiting_decision` tracks the supervisor's own effects, not user decisions.
- `.gitignore` already excludes the convergence grant; the gap is the missing explicit pathspec exclusion.
- Mentions of several agents already produce several owners.
- The hire path already admits allowlisted agents; supervision already detects staffing gaps.
- The conversation `not_applicable` rule is surface-neutral.
- The built-in integrations file is an open extension point.
- The package-boundary script reads dependencies, not imports.
- Two patterns were promoted, not one.
- The supervision token ceiling is already installed-proven; the research claim that Lervo lacks a token-budget experience is outdated.

The deliberation audit found that all 11 formal runs occurred on 2026-08-25 through the CLI inline policy, with 0 `converged`, no `deliberation`-scope usage, and no downstream consumer. The Discord natural path never reached the deliberation core because a separate discussion protocol was wired for the same effect. The 2026-10-01 "Sol and Opus opinions" reply was ordinary conversation with only Claude usage observed.
