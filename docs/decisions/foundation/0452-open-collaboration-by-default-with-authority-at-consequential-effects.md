# ADR-0452: Open collaboration by default with authority at consequential effects

Status: `accepted`
Decision date: 2026-10-04
Supersedes in part: [ADR-0391](../coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md), [ADR-0419](../coordination/conversations/0419-preserve-human-focus-and-real-agent-authorship.md)
Amends: [ADR-0386](../coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0395](../coordination/conversations/0395-resumable-native-repository-work-turns.md), [ADR-0398](../execution/orchestration/governed-work/0398-outcome-supervision-and-autonomous-team-allocation.md), [ADR-0411](../coordination/conversations/agent-organization/0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0417](../execution/applications/0417-own-discord-visible-reference-product.md), [ADR-0427](../knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md), [ADR-0434](../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0220](../knowledge/repository/0220-evidence-bound-development-pattern-promotion.md), [ADR-0396](../coordination/sync/0396-conflict-safe-repository-replica-continuation.md), [ADR-0201](../coordination/sync/0201-repository-scoped-workstream-replication.md), [ADR-0451](../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)

## True Lervo

True Lervo is an operating experience the owner can feel. One owner runs an organization of durable, distinct agents that converse and self-organize like a team: they answer when their role is relevant, mention each other, open and close discussions, and hire the roles they lack. The organization keeps working and improving over time without being driven turn by turn: standing goals continue under budgets, single observations become reviewed candidates, and candidates that prove useful in practice become skills, instructions, and profiles. A named central agent acts for the owner inside a delegated scope and escalates only outside it. Work follows the owner between the Mac terminal and Discord with code, checkpoint, and ownership intact. Every turn on every surface is grounded by the right canonical document at the right moment and is measured: which documents hit, which were used, how many tokens the outcome cost. All of this rests on a hardened, provider-neutral, local-first core whose events, evidence, identity, authority checks, and canonical knowledge do not bend when the edges are opened.

The [product vision](../../product/vision.md) already describes this. The diagnosis below shows the product contradicts it in practice.

## Context

Seven verified audits (ADR-0453 to ADR-0459 cite exact files) found one root cause: governance and verification gates were built before the product paths that feed them, and their defaults are closed. Conversation needs explicit addressing, agents answer only humans by default, delegation needs allowlists and exact role hashes, memory needs a hash-matching review, learning needs two independent verified groups, decisions need a human, knowledge from a no-change turn is `not_applicable`, replication needs a Hub or an opt-in parity flag, and the central agent cannot approve anything. Each gate is individually defensible; together they produce a product in which nothing happens unless the owner pushes.

Measured against the vision's success criteria:

- Criterion 10 (isolated durable agents collaborating through conversations, mentions, assignments, handoffs) is not met: one responder per message, no live mentions, work-outcome-only memory.
- Criterion 11 (every capability proven by a real installed Discord journey plus host-neutral conformance) is overstated: every `implemented` entry under `docs/roadmap/product-outcome-convergence/execution` and `repository-knowledge` rests on packed temporary consumers or scripted provider fixtures; only guild `/goal` intake and the supervision token ceiling have real installed evidence.
- "Work can continue on another device" fails between Mac and WSL: replica merges for three repositories have failed silently since 2026-09-30 and the Lervo repository was removed from replication.
- The central leadership agent does not relieve the owner: it has no decision, acceptance, or approval authority and is reachable only from the CLI.
- Criterion 12 (knowledge from any surface becomes canonical through review) fails in practice: zero of 57 per-change jobs reached `current`, conversation decisions never enter the pipeline, and instruction capture is unwired.
- Criterion 9 (measured improvement) is not the operating loop: hit precision exists only in scripted canaries, `used` is an opt-in citation, Discord repository-work turns and knowledge workers record neither context receipts nor usage, and one supervised review consumed about 2.6 million tokens without finishing.

Reliability defects found on the way share a pattern: silent replica failures with the cause discarded, an outbound retried tens of thousands of times, a stub reviewer settling every job as attention, and an exact role hash breaking a live delegation after a role migration. These are core robustness failures, not edge features.

## Decision

### 1. Governing principle

Conversation, memory, learning, recall, autonomy, and staffing are **open by default**. Authority is checked **at consequential effects**: repository writes, deployments, external messages, spend above a budget, credential or security-policy changes, hiring beyond headcount, and irreversible deletion. Budgets, loop guards, and compatibility windows are backstops that bound open behaviour; they are not admission conditions. The AGENTS.md invariants 1 to 9 are unchanged and are the test of whether an opening is safe.

### 2. Core and edge

| Hardened core (closed, contract-tested)                                                    | Open edge (default on, degradable)                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Event and evidence contracts, privacy redaction, append-only canonical chains              | Conversation participation, fan-out, mentions, discussions (ADR-0454) |
| Authority evaluation at consequential effects; mandates; approvals as evidence             | Principal-proxy intervention loop (ADR-0453)                          |
| Agent, role, participant, and speaker identity; lineage                                    | Agent memory kinds and recall (ADR-0454, ADR-0458)                    |
| Canonical knowledge review and materialization; writer lease; handoff (ADR-0456, ADR-0457) | Knowledge candidates from any surface; consolidation proposals        |
| Measurement contract: context receipts and usage events (ADR-0459)                         | Learning candidates and used-in-practice promotion (ADR-0458)         |
| Provider adapters and common contract tests; platform-neutral seams (ADR-0455)             | Heartbeat daemon, staffing proposals, projections and views           |

An edge feature may read canonical state freely but changes it only through typed application commands that the core validates. Each edge feature runs as its own loop with its own lease, kill switch (`features.<name>.enabled`), and error budget: after `maximumFailuresPerHour` bounded failures it disables itself, records `feature.degraded`, and raises one attention item. An edge failure therefore never corrupts canonical state, blocks local execution, or stops another edge feature.

### 3. Core robustness requirements

Every core and edge module must satisfy four general mechanisms, verified by shared contract tests:

1. **Error fidelity.** A wrapped failure carries `code`, `stage`, and a redacted `causeDigest`; the CLI and logs print the cause chain. An ESLint rule in the core packages forbids rethrowing a new `Error(string)` without `cause`. This retires the replica "could not be applied" class of failure.
2. **Bounded retry with attention escalation.** One `retry-policy` contract (`maximumAttempts`, backoff, `attentionAfter`) governs outbound delivery, replica cycles, knowledge jobs, and supervision dispatch. Exceeding `attentionAfter` records `attention_required` with an owner and recovery condition and publishes one notice; counters beyond the ceiling are a contract violation, so an outbound cannot retry twenty thousand times.
3. **Compatibility windows instead of exact binding.** Role, protocol, and schema compatibility use lineage and reader windows (`compatibleWith`), reserving exact hashes for evidence attestation and formal deliberation seats. A role migration must not break a live delegation.
4. **Truthful progress.** No job, decision, or delivery may remain pending beyond its bound without an owner and a recovery condition (ADR-0434's rule generalized). Zero successes out of N attempts in a window is itself an attention item, so "57 jobs, none current" cannot stay invisible.

### 4. Measurement as a core contract

Every feature on every channel feeds the same two records: a context receipt with distinct `selected`, `loaded`, `injected`, and `referenced` states, and `resource.usage.recorded` attributed to agent, conversation, channel, turn, and stage, labelled `provider_reported`, `lervo_measured`, or `estimated`. Precision context delivery and fine-grained usage are first-class differentiators: no reference product has evidence-grade hit or usage measurement. ADR-0459 restores precise hits on the compact terminal path without returning latency to the developer, defines hit precision, miss, and stale-hit metrics, and makes measured usage drive budgets and context pruning as the open conversation model raises spend.

### 5. Completion labels

The roadmap replaces `implemented` with a taxonomy that names the evidence:

- `contract-only`: schema, type, or specification exists; no runtime behaviour.
- `unwired`: runtime code exists but no CLI, Node, or surface path reaches it.
- `wired`: reachable from a shipped path; evidence is unit tests, scripted or fixture providers, or packed temporary consumers.
- `installed-proven`: the named scenario ran on an installed Node with real providers and, where the scenario is conversational, a real guild; a regression test exists at that boundary.
- `converged`: reserved for the true-Lervo journeys below.

`delivery required`, `external dependency`, and `external product` keep their meanings. Every label links its evidence. The roadmap entries that ADR-0458 and the strengths matrix verified as overstated are relabelled `wired` in this change.

### 6. True-Lervo journeys

Lervo is `converged` only when all six run on installed Nodes with real Codex and Claude, a real guild, and regression tests at the boundary:

- **J1 Goal to team.** The owner posts a goal in Discord; the product owner hires a missing role within headcount; agents discuss in a thread with live mentions; work proceeds with context receipts; a worker's in-scope decision is settled by the principal proxy; the verified result returns to the thread with a report of document hits and tokens per outcome.
- **J2 Follow the work.** The owner hands the repository off to the Mac with one command; code, checkpoint, and writer lease arrive intact; the Mac CLI continues; the Discord decision has become a canonical document; the owner hands back.
- **J3 Terminal learning.** A "from now on" instruction in Claude Code or Codex becomes a captured candidate; after review it hits on the next relevant prompt and the receipt records the hit.
- **J4 Robustness.** Injected replica divergence, provider failure, role migration, and stuck delivery each produce exactly one attention item with a cause; nothing loops silently; in-scope stalls are recovered by the proxy.
- **J5 Standing autonomy.** A heartbeat daemon continues a standing goal for 24 hours within budget; one useful observation becomes a candidate and is promoted after it is used in practice.
- **J6 Host neutrality.** J1 replays through the native-chat conformance suite and the platform ratchet holds.
- **J7 Decide with evidence.** A design fork during J1 triggers a Tier 0 cross-provider cross-check without anyone asking; disagreement escalates to a bounded review; the converged decision becomes a knowledge candidate and a resolved workstream decision, every opinion is backed by observed provider usage, and the owner hears about it only if it stays unresolved and consequential (ADR-0460).

### 7. What is removed or reversed

Single ownership of unaddressed human turns; human-only `respondTo`; answer-or-delegate exclusivity; exact role-hash equality for delegation; the Discord-only two-participant discussion ceremony; deliberation only on explicit human request; `approval_required` with no self-supply for in-mandate decisions; pending decisions blocking successors; whole-job knowledge rejection; `not_applicable` for decision turns; split-only normalization; host-independent knowledge convergence; the two-independent-group promotion rule as the only learning path; opt-in replica parity; silent `hold` divergence; `implemented` as a roadmap label.

### 8. Vision alignment

Criteria 1 to 13 stand. This decision proposes, through the reviewed exact-rewrite path that `document-layout.yaml` assigns to `docs/product/vision.md`, two amendments: criterion 10 adds "and self-organize: agents answer when relevant, address each other, and the product owner staffs missing roles within budget", and criterion 9 adds "measured hits and usage are the operating feedback loop, reported on every turn". The amendments are listed as a reviewed step in the roadmap rather than applied silently.

### 9. Owner decisions (2026-10-04)

The owner accepted every recommendation of this design set:

1. ADR-0452 to ADR-0460 are `accepted`; `implemented` is retired as a roadmap label in favour of the section 5 taxonomy.
2. The section 8 amendments to vision criteria 9 and 10 are applied to `docs/product/vision.md` as reviewed exact rewrites.
3. AGENTS.md gains invariant 10 (open by default, authority at consequential effects).
4. The first principal mandate uses the ADR-0453 version 1 defaults, including the 30-minute hire grace period.
5. `docs/evidence` is reclassified as projection-tier under ADR-0457 when the consolidation slice ships.
6. ADR-0418's "never the default engine" is amended by ADR-0460: Tier 0 is the default at decision points; formal deliberation runs on request or escalation.
7. The `conversation-discussion-*` protocol and the dead `terminal.deliberate` workflow are removed, not extended, when ADR-0460 Slice 3 replaces them.
8. Tier 0 keeps the 24k-token, two-call ceiling; `adr_authoring` on the Lervo repository is the first activation point.
9. `provider_claim_unproven` repairs the reply to a single-provider statement instead of refusing publication.

## Consequences

Agents become colleagues instead of gated executors, the owner is relieved by a proxy with recorded decisions, work moves between devices atomically, knowledge converges from every surface, learning happens from single observations, and every turn is measured. Token spend rises with openness and is made visible and bounded by measurement rather than by closing the door. ADR-0391's deterministic rendezvous, ADR-0419's human-focus coordinates, ADR-0418's optional formal deliberation, ADR-0427's asynchronous knowledge, and ADR-0434's accountable owner all survive; their closed defaults do not.

## References

- [Delivery sequence and journeys](../../roadmap/open-collaboration-platform.md)
- [Reference-product strengths matrix](../../roadmap/open-collaboration-platform/strengths-matrix.md)
- ADR-0453 principal mandate, ADR-0454 open rooms, ADR-0455 adapter boundary, ADR-0456 handoff, ADR-0457 knowledge intake, ADR-0458 learning and autonomy, ADR-0459 measurement, [ADR-0460 tiered deliberation](../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
