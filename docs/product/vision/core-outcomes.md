# Core outcomes

Status: `accepted`
Decision date: 2026-10-31

This document defines what Lervo must deliver, in order, and how the owner can tell it is delivered. It sets roadmap priority. Each layer builds on the one before it. Work on a later layer does not start before the earlier layers meet their targets on real repositories.

**Know → Find → Do → Connect → Collaborate → Surface**

The owner gives instructions. Lervo keeps knowledge current, finds what each task needs, and checks the work. Knowledge is linked tightly enough that its parts verify and complete each other. Several agents can then work on that core, from the terminal today, from Discord at the same level, and from a first-party product later.

## Why earlier work did not feel delivered

Earlier work added contracts and CLI routes. It was rarely wired into the terminal and Discord turns the owner actually uses. [ADR-0458](../../decisions/execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) records that roadmap entries were marked `implemented` on fixture evidence. Entry gates were often strict enough that nothing flowed: the development-pattern pipeline promoted one pattern in its lifetime. Completion meant passing tests, not a change the owner could see.

From now on, an item is done only when both of these hold:

1. **Felt outcome.** The owner can observe the result in installed terminal or Discord use, without running bookkeeping commands.
2. **Live measure.** A measure on real repositories moves toward its target and is reported by the core health signal.

## Principles for every layer

| Principle            | Meaning                                                                                                    | Canon                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Explainable          | Every judgment names its sources and evidence. `selected`, `loaded`, `injected`, and `used` stay distinct. | [Evidence language](execution/evidence-language.md)                                                                           |
| Fast                 | Prompt and Stop hooks stay within a fixed budget and never block on maintenance.                           | [ADR-0451](../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md) |
| Few tokens           | Context is the smallest set that answers the task. Progressive disclosure reveals more only on demand.     | [ADR-0459](../../decisions/execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md)       |
| Owner only instructs | Agents receive no bookkeeping instructions. Workstream, knowledge, and evidence upkeep is automatic.       | [ADR-0450](../../decisions/knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md)     |
| Nothing silent       | A stop, a skipped document, or a gap between canon and behavior is reported, never absorbed.               | This document                                                                                                                 |
| Lossless             | Migration and maintenance never drop content, documents, links, or rules.                                  | [Product vision](../vision.md), success criterion 2                                                                           |
| Same on every host   | Mac and WSL produce the same results; conflicts are resolved by coordination.                              | Owner rule `rule_f5f3724fc3ec2813038a99e4`                                                                                    |
| Demand first         | A feature is built after its demand is observed, and removed when it stays unused.                         | Owner decision, 2026-10-31                                                                                                    |

The core principles are injected into every turn in compact form, so agents do not depend on recalling them.

## Layers

Measurements marked "observed 2026-10-31" come from the `lervo` repository and the WSL owner host unless stated otherwise.

### 1. Know: knowledge is current and correct

- **Felt outcome.** After development, the owner sees a short report of what Lervo learned: which canonical documents changed, why, and what they now link to. Nothing waits silently.
- **Measures.**
  - Reflection lag: time from a merged change to its canonical update.
  - Stale document backlog. Observed: 74 stale documents.
  - Longest silent stop. Observed: four repositories stopped for one to two weeks.
  - Migration completeness: every candidate is moved, kept with a reason, or deferred with a resolution condition, and no link is broken. Observed: a root `TRACE.md` stays deferred indefinitely, and 10 links are broken after moves.
- **Strength adopted. Hermes, immediate memory.** An owner instruction, correction, or verified work outcome becomes a reviewable candidate within the same turn. Instruction capture ([ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)) already does this for owner rules. It extends to practice learned from work, and replaces the removed development-pattern pipeline.

### 2. Find: the right documents are hit

- **Felt outcome.** Each turn starts with the rules and canonical documents that govern the files involved. An answer cites what it used.
- **Measures.**
  - Recall and precision on a replay set built from past changes. The documents that govern changed paths are the expected hits.
  - Miss rate: a turn touched a governing document that was not selected.
  - Used proof: a selected document is cited, or the change follows it. Observed: zero used proofs ever, and no injected documents since 2026-09-08.
- **Strength adopted. Hermes, progressive disclosure and tool search.** Rules that apply to touched paths are attached deterministically, without a provider call. Wider documents, skills, and tool definitions are revealed only when needed.

### 3. Do: work is accurate and explainable

- **Felt outcome.** Agents work with the right context. A result that conflicts with canon is flagged before completion, with the conflicting source.
- **Measures.**
  - Prompt hook p95 latency and failure rate.
  - Tokens injected per turn.
  - Canon conflicts caught before completion.
- **Strength adopted. Prime Agent, long-running work.** Work attaches to the current workstream, resumes across sessions and hosts, and continues toward a goal without the owner restating context. Runtime lessons become reviewable candidates, never silent self-modification.

### 4. Connect: knowledge forms a verified web

- **Felt outcome.** Changing code or a decision surfaces every document that depends on it. Superseded decisions fold into one current-state document.
- **Measures.**
  - Canonical documents with source, decision, and rule links.
  - Orphan documents.
  - Broken links.
  - Length of amendment chains not yet consolidated. Observed: more than 530 ADRs with no current-state consolidation.
- **Approach.** Start from deterministic links that already exist: document links, code references, ADR amendment chains, rules to paths, and workstreams to documents. A change re-verifies its linked documents. Model-inferred relations come later, and only with inputs that produce them.

### 5. Collaborate: agents work together on the core

- **Felt outcome.** Agents divide work, hand off, and check each other. When knowledge conflicts or results disagree, a cross-check runs without the owner starting it.
- **Strengths adopted.**
  - **Buzz:** threads, mentions, and an inbox routed into agent identity, assignments, and handoffs. Joining a room never grants repository authority.
  - **Paperclip:** a read-only operating board of agents, work, blockers, approvals, and cost. It projects Lervo contracts and never becomes the authority.
  - **Deliberation:** a system-triggered cross-check at decision points ([ADR-0460](../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)), not a feature the owner must call.
- **Measures.**
  - Handoffs completed.
  - Disagreements resolved with recorded evidence.
  - Cost visible per agent and channel.

### 6. Surface: one core, many surfaces

- **Felt outcome.** The terminal works first. Discord offers the same capabilities, such as "make that a rule", status, and the board. A first-party product later uses the same core and goes further.
- **Approach.** The core is a headless service. Terminal and Discord are thin adapters over the same application commands.
- **Measure.** A parity checklist per capability, verified in installed use.

## Order of work

1. **Core health signal.** One status across repositories and hosts reporting every measure above, including gaps between canon and behavior. Silent failure was the largest observed problem.
2. **Know and Find to target.** Remove silent stops. Complete migrations. Attach governing rules deterministically. Record used proof.
3. **Do and Connect.**
4. **Collaborate, then Surface parity.**

## Related

- [Product vision](../vision.md)
- [Product positioning and verified improvement research](../../research/lervo-product-positioning-and-verified-improvement.md)
- [Paperclip comparison](../../research/paperclip-lervo-comparison.md)
- [Open collaboration platform, ADR-0452](../../decisions/foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
