# Open collaboration acceptance and context

## Acceptance metrics

Report weekly from ADR-0459 projections, per channel and agent:

- Retrieval: hit precision at or above 0.7 on conversation and supervision channels; miss rate below 0.1; stale-hit rate below 0.02.
- Token use: tokens per successful outcome trend down over four weeks for one standing goal; no supervised run exceeds its reservation in flight.
- Conversation: duplicate human-turn answers below 5 percent; exchange budget exhaustion visible every time.
- Knowledge: at least 90 percent of per-change jobs reach `current`; zero generated review sources.
- Replicas: at most one attention item per divergence identity; zero silent repeats.
- Proxy settlements: 100 percent inside mandate scope, each with a recorded decision event.
- Deliberation: Tier 0 rate of 100 percent on `adr_authoring` points; `outcomeChangeRate` above zero for Tier 1 and 2; zero `unverified` artifacts counted toward convergence; `laterDefectRate` reported with and without deliberation; Tier 0 cost at or below 24,000 tokens per run.
- Document freshness: time to a verified candidate p90 under 30 minutes for `safety` and `entrypoint` findings; false-positive rate below 10 percent; acceptance rate above 70 percent; tokens per applied update at or below 40,000; revert rate below 5 percent; no stale entrypoint older than one escalation batch window without an open candidate or owner question.

## Evidence-based relabeling

Under ADR-0452 section 5, these entries moved from `implemented` to `wired` because their evidence uses packed temporary consumers or fixture providers:

- Every [Prime-Agent-derived execution outcome](../product-outcome-convergence/execution.md) except provider-native resume.
- Every [repository knowledge outcome](../product-outcome-convergence/repository-knowledge.md).
- Reviewed local and authenticated live triggers, Slack, dynamic execution graphs, replaceable components, and separately installed hosts in [host-product outcomes](../product-outcome-convergence/host-products.md).

Guild `/goal` intake and the supervision token ceiling retain installed evidence and the label `installed-proven`. The multi-party conversation entry replaces undefined `installed acceptance required` with `delivery required`.

## Corrections to the diagnosis

Verification established these corrections:

- "Tarin" is a deployment identity, not a code mapping.
- `waiting_decision` tracks the supervisor's own effects, not user decisions.
- `.gitignore` already excludes the convergence grant; the gap is the missing explicit pathspec exclusion.
- Mentions of several agents already produce several owners.
- The hire path already admits allowlisted agents; supervision already detects staffing gaps.
- The conversation `not_applicable` rule is surface-neutral.
- The built-in integrations file is an open extension point.
- The package-boundary script reads dependencies, not imports.
- Two patterns were promoted, not one.
- The supervision token ceiling is already `installed-proven`; the research claim that Lervo lacks a token-budget experience is outdated.

The deliberation audit found that all 11 formal runs occurred on 2026-08-25 using the CLI inline policy, with 0 `converged`, no `deliberation`-scope usage, and no downstream consumer. The Discord natural path never reached the deliberation core because a separate discussion protocol was wired for the same effect. The 2026-10-01 "Sol and Opus opinions" reply was ordinary conversation with only Claude usage observed.

## References

- [Product outcome convergence](../product-outcome-convergence.md)
- [Discord-first reference product](../product-outcome-convergence/host-products/discord-first-reference-product.md)
- [Autonomous background convergence](../knowledge/autonomous-background-convergence.md)
- [ADR-0463 document freshness](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) and its [specification](../../specifications/knowledge/document-freshness.md)
- [Product vision](../../product/vision.md)
