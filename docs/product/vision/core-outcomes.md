# Core outcomes

Status: `accepted`
Decision date: 2026-10-31

## Lervo is an intelligent system

Lervo judges, verifies, and learns by itself. It decides what becomes knowledge and where it belongs. It finds what each task needs and checks the work against canon. It learns from instructions, corrections, and verified outcomes. It links knowledge tightly enough that its parts verify and complete each other. Every judgment carries its sources and evidence, so the intelligence stays inspectable rather than opaque.

The owner gives instructions. Lervo does the upkeep, including review. The owner hears only about decisions that need owner authority, batched and with a recommendation.

Three properties are the baseline every outcome below keeps, not the goal:

- **Continuity.** Agents, providers, sessions, and hosts change; repository truth remains.
- **Assurance.** Results are backed by recorded evidence and verification.
- **Verified improvement.** Lervo learns through reviewed, evidence-bound change, never opaque agent memory.

The existing boundaries also stay in force:

- local work completes without a Hub;
- provider behavior stays behind adapters;
- user-owned content changes only through exact review;
- graphs and indexes are rebuildable projections.

See the [product vision](../vision.md) and the [Paperclip safeguards](../../research/paperclip-lervo-comparison/safeguards.md).

## Why earlier work did not feel delivered

Lessons from Hermes, Prime Agent, Buzz, and Paperclip became accepted decisions ([ADR-0452](../../decisions/foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md) to [ADR-0460](../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)), contracts, and CLI routes. Few reached the terminal and Discord turns the owner uses:

- [ADR-0458](../../decisions/execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) records roadmap entries marked `implemented` on fixture evidence.
- Strict entry gates let almost nothing flow: the development-pattern pipeline promoted two patterns in its lifetime.
- Upkeep reached the owner as review requests instead of being resolved. Each terminal turn on 2026-10-31 asked the owner to review stale documents, a freshness candidate, and a held decision.
- The prompt context gave the agent a declaration task, omitted two of three applied owner rules, and truncated the workstream line.

## Principles

| Principle            | Meaning                                                                                                                                                                                                                                                                                                                              | Canon                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-reviewing       | An independent reviewer agent, not the generator and not the owner, checks knowledge, canon, document updates, normalization, and candidate promotion. Only consequential effects (AGENTS.md invariant 10) reach the owner, batched with evidence and a recommendation. Within a mandate, the principal proxy decides for the owner. | [ADR-0453](../../decisions/coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) |
| Owner only instructs | The owner never issues bookkeeping commands. Lervo performs authorized upkeep automatically.                                                                                                                                                                                                                                         | [ADR-0450](../../decisions/knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)                                                                                                                                                   |
| Explainable          | Each judgment names exact sources and hashes. `selected`, `loaded`, `injected`, and `referenced` stay distinct. Internal semantic use is unsupported. Missing telemetry is `unknown`, never zero.                                                                                                                                    | [Evidence language](execution/evidence-language.md), [ADR-0459](../../decisions/execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md)                                                                                                |
| Fast                 | Prompt and Stop hooks keep a fixed budget and never wait on maintenance.                                                                                                                                                                                                                                                             | [ADR-0451](../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)                                                                                                                                               |
| Few tokens           | Judge cost as tokens per successful outcome, so quality is not traded for size. Progressive disclosure reveals more only on demand.                                                                                                                                                                                                  | [ADR-0459](../../decisions/execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md)                                                                                                                                                     |
| Nothing silent       | A stop, a skipped document, or a gap between canon and behavior is reported with an owner or recovery condition.                                                                                                                                                                                                                     | This document                                                                                                                                                                                                                                                               |
| Lossless             | Migration and maintenance never drop content, documents, links, or rules.                                                                                                                                                                                                                                                            | [Product vision](../vision.md), criterion 2                                                                                                                                                                                                                                 |
| Same on every host   | Under the same source, rules, and build, Mac and WSL produce equivalent results under one authority history. Without observations from both hosts, parity is `unknown`.                                                                                                                                                              | Owner rule `rule_f5f3724fc3ec2813038a99e4`, [ADR-0456](../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md)                                                                                                                      |
| Demand first         | New scope needs observed demand: a request, a repeated failure, or a measured gap. Missing wiring or telemetry is not evidence of no demand. Protective features stay even when rarely triggered.                                                                                                                                    | Owner decision, 2026-10-31                                                                                                                                                                                                                                                  |

The goal is that every turn carries these principles in compact form, so agents do not depend on recall. Its delivery is reported as `prepared`, `delivered`, or `provider-confirmed`.

## Layers

**Know → Find → Do → Connect → Collaborate → Surface** is the order of investment, not a start gate. A later layer's prerequisite is built when an earlier outcome needs it. For example, Find needs the rule-to-path links of Connect. Every capability is accepted through both terminal and Discord journeys. The first-party product follows observed demand.

Strengths from the four reference products land where they serve an outcome. The [strengths matrix](../../roadmap/open-collaboration-platform/strengths-matrix.md) keeps each accepted capability's status and evidence. Every accepted capability is retained unless a decision explicitly supersedes it.

### 1. Know: knowledge is current and correct

- **Felt outcome.** After development, the owner receives a short notice of what Lervo learned, which canonical documents changed and why, and what they link to. It is information, not a task. Nothing waits silently. [ADR-0549](../../decisions/execution/applications/0549-tell-the-owner-what-lervo-learned-after-development.md) delivers it in compact terminal turns from Lervo's own commits.
- **Measures.**
  - Lag from a source change to its canonical update.
  - Stale document backlog.
  - The longest stop, and how long it went unreported.
  - Owner review requests per week (target near zero), and items waiting on the owner.
  - Migration completeness: each candidate is moved, kept with a reason, or deferred with a resolution condition, and no link is broken.
- **Strengths.**
  - **Hermes immediate memory:** an instruction, correction, or verified work outcome is captured in its turn. A reviewable candidate or a reason to hold appears within a bounded time. This extends instruction capture ([ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)).
  - **ADR-0458 learning:** a candidate comes from a single observation, and is promoted by used-in-practice evidence and independent review. The successor [background practice learning](../../roadmap/knowledge/background-practice-learning.md) is wired in the standalone resident; Hub typed exchange and installed acceptance remain open.

### 2. Find: the right documents are hit

- **Felt outcome.** Each turn starts with the rules and canonical documents that govern the files involved, and the answer cites what it relied on.
- **Measures.**
  - Evaluation: recall and precision on a replay set from past changes. Expected documents are the governing rules and canon of the changed paths, confirmed by an independent reviewer agent rather than the owner.
  - Operation: hit precision, miss rate, and stale-hit rate from selected, injected, and referenced receipts. Targets: precision at least 0.7, miss rate below 0.1, stale-hit rate below 0.02 ([acceptance and evidence](../../roadmap/open-collaboration-platform/acceptance-and-evidence.md)).
  - Rule conformance of the result, verified independently, as an outcome measure.
- **Strengths.**
  - **Hermes progressive disclosure and tool search:** rules for touched paths attach deterministically, without a provider call. Wider documents, skills, and tool definitions appear only when needed.
  - **Hermes conversation recall** (ADR-0458): earlier promises and judgments are found, scoped to the agent or channel, and marked non-canonical.

### 3. Do: work is accurate and explainable

- **Felt outcome.** Agents work with the right context. A result that conflicts with canon is flagged before completion, with the conflicting source.
- **Measures.**
  - Verified success rate.
  - Rework and owner-correction rate.
  - Prompt, Stop, and end-to-end latency at p95.
  - Tokens per successful outcome.
  - The share of judgments traceable to exact sources and verification.
- **Strengths.** **Prime Agent long-running work:** attach, resume, goals, heartbeats, and bounded continuation over the workstream (ADR-0458). Measured by liveness, progress, blocked time, and resumption. Runtime lessons become reviewable candidates, never silent self-modification.

### 4. Connect: knowledge forms a verified web

- **Felt outcome.** Changing code or a decision surfaces every document that depends on it, and re-verifies them. Superseded decisions fold into current-state documents.
- **Measures.**
  - Canonical documents with the source, decision, and rule links their kind requires.
  - Orphan documents, with entrypoints and historical records excepted.
  - Broken links.
  - Amendment chains not yet folded into a current-state document.
  - Recall of affected documents after a change.
- **Approach.** Start from deterministic links: document links, code references, ADR amendment chains, rules to paths, and workstreams to documents. Model-inferred relations come only once there are inputs that produce them.

### 5. Collaborate: agents work together on the core

- **Felt outcome.** Agents divide work, hand off, and check each other. When knowledge conflicts or results disagree, a cross-check runs without the owner starting it. The owner hears only an unresolved, consequential outcome.
- **Strengths.**
  - **Buzz:** threads, mentions, an inbox, and agent-to-agent turns in rooms, routed into identity, assignments, and handoffs. Delivery, acknowledgment, action, and verified result stay distinct. Joining a room never grants repository authority.
  - **Prime Agent:** subagents with durable identity, ancestry, scoped leases, and path-conflict checks.
  - **Paperclip:** a read-only operating board projecting agents, work, blockers, approvals, and cost. Budgets, warnings, and in-flight caps limit spend.
  - **Deliberation:** a system-triggered cross-check at decision points ([ADR-0460](../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)).
- **Measures.**
  - Handoffs created, received, and resumed.
  - Disagreements resolved with verified follow-up effects.
  - Cost attributed per agent and channel, separating observed from estimated.

### 6. Surface: one core, many surfaces

- **Felt outcome.** Each capability works from the terminal and from Discord. Discord offers the same capabilities, such as "make that a rule", status, and the board. A first-party product later uses the same core and goes further.
- **Approach.** The core is a headless service. Terminal and Discord are thin adapters over the same application commands ([ADR-0455](../../decisions/execution/applications/0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md)).
- **Measure.** A per-capability parity matrix, verified in installed journeys.

## Completion

These outcomes add to the ADR-0452 labels: `unwired`, `wired`, `installed-proven`, and `converged`. An outcome is complete only when:

1. **Predeclared.** Its installed journey, target, denominator, minimum sample, observation window, and required provider, host, and surface are recorded before the work starts.
2. **Evidenced.** Its evidence binds the repository revision, installed build, environment, fixture flag, event and receipt IDs with hashes, and the verification result. An author's statement alone never counts.
3. **Labeled from evidence.** Fixture or temporary-consumer evidence earns at most `wired`. Missing, stale, or other-build evidence leaves the outcome incomplete or `unknown`. Discord capabilities need a real guild journey.
4. **Sustained.** The target is met or maintained over its window, and the health signal shows any regression.

This rule governs completion claims. It never blocks the owner's ordinary work.

## Baseline, 2026-10-31

| Measure                            | Value                                                                                                                                                                                                                                                                | Source                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Stale documents (`lervo`, Mac)     | 74 in the 00:14 UTC freshness summary; 71 of 186 evaluated documents in the 01:53 UTC staleness report, with 1,504 of 1,690 documents unevaluated                                                                                                                    | `.lervo/state/knowledge/freshness-cycle.json`, `document-staleness.json` |
| Context injection (`lervo`, Mac)   | 128 `context.injected` events; the last at 2026-09-08 15:12 UTC                                                                                                                                                                                                      | `.lervo/data/events.sqlite`                                              |
| Explicit references (`lervo`, Mac) | 33 `context.referenced`, the last on 2026-09-03; 21 `terminal.reference.observed`. Semantic use is unsupported.                                                                                                                                                      | `.lervo/data/events.sqlite`                                              |
| Broken links (`lervo`, Mac)        | 10 `markdown_link_target_missing` findings                                                                                                                                                                                                                           | `lervo knowledge lint --json`, 2026-10-31                                |
| Deferred root documents            | A root `TRACE.md` is deferred as `semantic_classification_pending` by a migration plan without a provider                                                                                                                                                            | `lervo migrate knowledge --json` in a scratch repository                 |
| Convergence stops (WSL owner host) | On 2026-10-25: `lervo` and `digimon` were waiting on `canonical_target_diverged`, `axli` on `document_directory_file_capacity_exceeded`, and `flemo` on `review_context_unavailable`. `digimon` and `axli`/`flemo` had been stopped since 2026-10-12 and 2026-10-18. | `lervo knowledge convergence status --json` and stage records            |
| ADR files                          | 531. Unfolded amendment chains are not yet measured.                                                                                                                                                                                                                 | `docs/decisions`                                                         |
| Promoted development patterns      | 2                                                                                                                                                                                                                                                                    | `development.pattern.transitioned` events                                |

## Order of work

1. **Health signal, small first.** Start with Know and Find for one repository: a read-only projection of state that already exists, with missing data shown as `unknown`. Attach it to existing attention and turn reports rather than a new command. Compute it in the background without a provider call. Judge it by stop detected → owner or recovery condition named → time to resolution.
2. **Know and Find slices to target.**
   - Remove silent stops.
   - Make migrations complete.
   - Resolve reviews without the owner.
   - Attach governing rules deterministically.
   - Record explicit references.
3. **Do and Connect slices.**
4. **Collaborate.**

Each slice ships through terminal and Discord acceptance.

## Related

- [Product vision](../vision.md)
- [Product positioning and verified improvement research](../../research/lervo-product-positioning-and-verified-improvement.md)
- [Paperclip comparison](../../research/paperclip-lervo-comparison.md)
- [Open collaboration platform roadmap](../../roadmap/open-collaboration-platform.md)
