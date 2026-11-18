# ADR-0452: Open collaboration by default with authority at consequential effects

Status: `accepted`
Decision date: 2026-10-04
Supersedes in part: [ADR-0391](../coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md), [ADR-0419](../coordination/conversations/0419-preserve-human-focus-and-real-agent-authorship.md)
Amends: [ADR-0386](../coordination/conversations/0386-organization-teams-and-agent-identities.md), [ADR-0395](../coordination/conversations/0395-resumable-native-repository-work-turns.md), [ADR-0398](../execution/orchestration/governed-work/0398-outcome-supervision-and-autonomous-team-allocation.md), [ADR-0411](../coordination/conversations/agent-organization/0411-governed-agent-memory-and-autonomous-participation.md), [ADR-0417](../execution/applications/0417-own-discord-visible-reference-product.md), [ADR-0427](../knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md), [ADR-0434](../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0220](../knowledge/repository/0220-evidence-bound-development-pattern-promotion.md), [ADR-0396](../coordination/sync/0396-conflict-safe-repository-replica-continuation.md), [ADR-0201](../coordination/sync/0201-repository-scoped-workstream-replication.md), [ADR-0451](../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)
Amended by: [ADR-0561](0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (cross-check, reversible effect, and notice instead of an authority check)

## True Lervo

One owner runs an organization of durable, distinct agents that converse and self-organize: they answer when relevant to their roles, mention each other, open and close discussions, and hire missing roles. Work and improvement continue without turn-by-turn direction. Standing goals run under budgets; single observations become reviewed candidates; candidates proven useful in practice become skills, instructions, and profiles.

A named central agent acts for the owner within delegated scope and escalates only outside it. Work follows the owner between the Mac terminal and Discord with code, checkpoint, and ownership intact. Every turn on every surface receives the right canonical document at the right moment and measures document hits, use, and tokens per outcome. A hardened, provider-neutral, local-first core preserves events, evidence, identity, authority checks, and canonical knowledge as edges open.

The [product vision](../../product/vision.md) already describes this experience; the audit found the product contradicts it in practice.

## Context

Seven verified audits, with exact files cited in ADR-0453 to ADR-0459, found governance and verification gates built before their feeding product paths, with closed defaults. Conversation requires explicit addressing; agents answer only humans by default; delegation requires allowlists and exact role hashes; memory requires hash-matching review; learning requires two independent verified groups; decisions require a human; no-change-turn knowledge is `not_applicable`; replication requires a Hub or opt-in parity flag; and the central agent cannot approve anything. Together, these individually defensible gates require the owner to drive everything.

Against the vision's success criteria:

- **Criterion 10:** isolated durable agents collaborating through conversations, mentions, assignments, and handoffs is unmet: there is one responder per message, no live mentions, and work-outcome-only memory.
- **Criterion 11:** real installed Discord journeys plus host-neutral conformance for every capability is overstated. Every `implemented` entry under `docs/roadmap/product-outcome-convergence/execution` and `repository-knowledge` relies on packed temporary consumers or scripted provider fixtures. Only guild `/goal` intake and the supervision token ceiling have real installed evidence.
- **Cross-device continuation:** Mac–WSL replica merges for three repositories have failed silently since 2026-09-30; the Lervo repository was removed from replication.
- **Central leadership:** the agent has no decision, acceptance, or approval authority and is reachable only from the CLI, so it does not relieve the owner.
- **Criterion 12:** reviewed canonical knowledge from any surface fails in practice: zero of 57 per-change jobs reached `current`, conversation decisions never enter the pipeline, and instruction capture is unwired.
- **Criterion 9:** measured improvement is not the operating loop. Hit precision exists only in scripted canaries; `used` is an opt-in citation; Discord repository-work turns and knowledge workers record neither context receipts nor usage; one supervised review consumed about 2.6 million tokens without finishing.

Core robustness failures include silent replica failures with discarded causes, an outbound retried tens of thousands of times, a stub reviewer settling every job as attention, and exact role hashes breaking live delegation after role migration.

## Decision

### 1. Governing principle

Conversation, memory, learning, recall, autonomy, and staffing are **open by default**. Check authority **at consequential effects**: repository writes, deployments, external messages, spend above budget, credential or security-policy changes, hiring beyond headcount, and irreversible deletion.

> **Amended (2026-11-02).** Under [ADR-0561](0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), no consequential effect waits for an owner approval. Each one is cross-checked by an independent session, made reversible by a commit, preimage, or backup, and reported in an after-the-fact notice with its undo command. An effect that cannot be undone or leaves the host needs two agreeing checks and a backup or dry run first. Budgets and loop guards remain hard backstops. Credentials are the one notice-only exception: Lervo reports what is missing and continues every stage that does not need them.

Budgets, loop guards, and compatibility windows bound open behaviour; they are not admission conditions. AGENTS.md invariants 1 to 9 remain unchanged and determine whether an opening is safe.

### 2. Core and edge

| Hardened core: closed, contract-tested | Open edge: default on, degradable |
| --- | --- |
| Event and evidence contracts, privacy redaction, append-only canonical chains | Conversation participation, fan-out, mentions, discussions (ADR-0454) |
| Authority evaluation at consequential effects; mandates; approvals as evidence | Principal-proxy intervention loop (ADR-0453) |
| Agent, role, participant, and speaker identity; lineage | Agent memory kinds and recall (ADR-0454, ADR-0458) |
| Canonical knowledge review and materialization; writer lease; handoff (ADR-0456, ADR-0457) | Knowledge candidates from any surface; consolidation proposals |
| Measurement contract: context receipts and usage events (ADR-0459) | Learning candidates and used-in-practice promotion (ADR-0458) |
| Provider adapters and common contract tests; platform-neutral seams (ADR-0455) | Heartbeat daemon, staffing proposals, projections and views |

Edges may read canonical state freely but change it only through core-validated typed application commands. Each feature has its own loop, lease, kill switch (`features.<name>.enabled`), and error budget. After `maximumFailuresPerHour` bounded failures, it disables itself, records `feature.degraded`, and raises one attention item. Edge failure must never corrupt canonical state, block local execution, or stop another edge feature.

### 3. Core robustness requirements

Shared contract tests verify four mechanisms in every core and edge module:

1. **Error fidelity:** wrapped failures carry `code`, `stage`, and a redacted `causeDigest`; CLI and logs print the cause chain. A core-package ESLint rule forbids rethrowing a new `Error(string)` without `cause`, retiring replica failures reported only as "could not be applied".
2. **Bounded retry with attention escalation:** one `retry-policy` contract (`maximumAttempts`, backoff, `attentionAfter`) governs outbound delivery, replica cycles, knowledge jobs, and supervision dispatch. Exceeding `attentionAfter` records `attention_required` with an owner and recovery condition and publishes one notice. Counters beyond the ceiling violate the contract; an outbound cannot retry twenty thousand times.
3. **Compatibility windows instead of exact binding:** role, protocol, and schema compatibility use lineage and reader windows (`compatibleWith`). Exact hashes are reserved for evidence attestation and formal deliberation seats. Role migration must not break live delegation.
4. **Truthful progress:** no job, decision, or delivery may remain pending beyond its bound without an owner and recovery condition, generalizing ADR-0434. Zero successes out of N attempts in a window is itself an attention item; "57 jobs, none current" cannot remain invisible.

### 4. Measurement as a core contract

Every feature on every channel feeds the same two records: a context receipt with distinct `selected`, `loaded`, `injected`, and `referenced` states, and `resource.usage.recorded` attributed to agent, conversation, channel, turn, and stage, labelled `provider_reported`, `lervo_measured`, or `estimated`.

Precise context delivery and fine-grained usage are first-class differentiators; no reference product has evidence-grade hit or usage measurement. ADR-0459 restores precise compact-terminal hits without developer latency, defines hit precision, miss, and stale-hit metrics, and uses measured usage for budgets and context pruning as open conversation raises spend.

### 5. Completion labels

Replace roadmap `implemented` labels with evidence-specific labels:

- `contract-only`: schema, type, or specification exists; no runtime behaviour.
- `unwired`: runtime code exists, but no CLI, Node, or surface path reaches it.
- `wired`: reachable from a shipped path; evidence comprises unit tests, scripted or fixture providers, or packed temporary consumers.
- `installed-proven`: the named scenario ran on an installed Node with real providers and, for conversational scenarios, a real guild; a regression test exists at that boundary.
- `converged`: reserved for the true-Lervo journeys below.

`delivery required`, `external dependency`, and `external product` retain their meanings. Every label links its evidence. Entries verified as overstated by ADR-0458 and the strengths matrix are relabelled `wired` in this change.

### 6. True-Lervo journeys

Lervo is `converged` only when all listed journeys run on installed Nodes with real Codex and Claude, a real guild, and boundary regression tests:

- **J1 Goal to team:** the owner posts a Discord goal; the product owner hires a missing role within headcount; agents discuss in a thread with live mentions; work proceeds with context receipts; the principal proxy settles a worker's in-scope decision; the verified result returns to the thread with document hits and tokens per outcome.
- **J2 Follow the work:** the owner hands the repository to the Mac with one command; code, checkpoint, and writer lease arrive intact; the Mac CLI continues; the Discord decision has become a canonical document; the owner hands back.
- **J3 Terminal learning:** a "from now on" instruction in Claude Code or Codex becomes a captured candidate; after review, it hits on the next relevant prompt and its receipt records the hit.
- **J4 Robustness:** injected replica divergence, provider failure, role migration, and stuck delivery each produce exactly one attention item with a cause. Nothing loops silently; the proxy recovers in-scope stalls.
- **J5 Standing autonomy:** a heartbeat daemon continues a standing goal for 24 hours within budget; one useful observation becomes a candidate and is promoted after use in practice.
- **J6 Host neutrality:** J1 replays through the native-chat conformance suite and the platform ratchet holds.
- **J7 Decide with evidence:** a J1 design fork automatically triggers a Tier 0 cross-provider cross-check; disagreement escalates to bounded review. The converged decision becomes both a knowledge candidate and a resolved workstream decision. Observed provider usage backs every opinion; the owner hears about it only if it remains unresolved and consequential (ADR-0460).

### 7. What is removed or reversed

- Single ownership of unaddressed human turns; human-only `respondTo`; answer-or-delegate exclusivity.
- Exact role-hash equality for delegation; the Discord-only two-participant discussion ceremony; deliberation only on explicit human request.
- `approval_required` without self-supply for in-mandate decisions; pending decisions blocking successors.
- Whole-job knowledge rejection; `not_applicable` for decision turns; split-only normalization; host-independent knowledge convergence.
- The two-independent-group promotion rule as the only learning path.
- Opt-in replica parity; silent `hold` divergence; `implemented` as a roadmap label.

### 8. Vision alignment

Criteria 1 to 13 stand. Through the reviewed exact-rewrite path assigned by `document-layout.yaml` to `docs/product/vision.md`, this decision proposes two amendments:

- Criterion 10 adds "and self-organize: agents answer when relevant, address each other, and the product owner staffs missing roles within budget".
- Criterion 9 adds "measured hits and usage are the operating feedback loop, reported on every turn".

The roadmap lists these as a reviewed step, not silent amendments; the owner decisions below record their acceptance and application.

### 9. Owner decisions (2026-10-04)

The owner accepted every recommendation in this design set:

1. ADR-0452 to ADR-0460 are `accepted`; `implemented` is retired as a roadmap label in favour of the section 5 taxonomy.
2. The section 8 amendments to vision criteria 9 and 10 are applied to `docs/product/vision.md` as reviewed exact rewrites.
3. AGENTS.md gains invariant 10: open by default, authority at consequential effects. ADR-0561 later changed it to cross-check, make reversible, and notify at consequential effects.
4. The first principal mandate uses ADR-0453 version 1 defaults, including the 30-minute hire grace period.
5. `docs/evidence` becomes projection-tier under ADR-0457 when the consolidation slice ships.
6. ADR-0460 amends ADR-0418's "never the default engine": Tier 0 is the default at decision points; formal deliberation runs on request or escalation.
7. The `conversation-discussion-*` protocol and dead `terminal.deliberate` workflow are removed, not extended, when ADR-0460 Slice 3 replaces them.
8. Tier 0 retains its 24k-token, two-call ceiling; `adr_authoring` on the Lervo repository is the first activation point.
9. `provider_claim_unproven` repairs the reply to a single-provider statement instead of refusing publication.

## Consequences

Agents become colleagues; a proxy relieves the owner through recorded decisions; work moves atomically between devices; knowledge converges from every surface; learning starts from single observations; every turn is measured. Openness increases token spend, which measurement makes visible and bounded.

ADR-0391's deterministic rendezvous, ADR-0419's human-focus coordinates, ADR-0418's optional formal deliberation, ADR-0427's asynchronous knowledge, and ADR-0434's accountable owner survive; their closed defaults do not.

## References

- [Delivery sequence and journeys](../../roadmap/open-collaboration-platform.md)
- [Reference-product strengths matrix](../../roadmap/open-collaboration-platform/strengths-matrix.md)
- ADR-0453 principal mandate, ADR-0454 open rooms, ADR-0455 adapter boundary, ADR-0456 handoff, ADR-0457 knowledge intake, ADR-0458 learning and autonomy, ADR-0459 measurement, [ADR-0460 tiered deliberation](../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
