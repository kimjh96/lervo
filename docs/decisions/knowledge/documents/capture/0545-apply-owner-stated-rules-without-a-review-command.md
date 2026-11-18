# ADR-0545: Apply owner-stated rules without a review command

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0467](../0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) (review and application)
Superseded in part by: [ADR-0561](../../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (the plan gate, the `explicit_user` restriction, the catalog binding, and `lervo knowledge instruction review` are removed)
Related: [ADR-0535](../../../execution/applications/0535-project-core-health-with-actor-owned-attention.md) (actor-owned attention)

> **Superseded in part (2026-11-02).** Under ADR-0561 the plan gate described below no longer exists: every grounded owner rule is stored with its classification, and every stored candidate is applied, whatever its authority. Candidates are no longer bound to their assessed catalog; apply rebuilds the plan against current bytes. The settling identity is `lervo`, not `lervo-principal-proxy`. `lervo knowledge instruction review` is removed; `lervo knowledge instruction retire <rule-id>` is the undo. The owner-host apply, commit, settlement, and Hub exchange below remain in force.

## Context

[ADR-0467](../0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) captures owner rules from conversation, but every candidate still waited for `lervo knowledge instruction review`. That ADR recommended automatic application of rules the owner states and deferred it. [ADR-0535](../../../execution/applications/0535-project-core-health-with-actor-owned-attention.md) then moved routine review off the owner, but the review command remained the only way to apply a rule. Someone still had to run it: the owner, or an agent asked to.

On 2026-11-01 the owner stated a working rule in a Claude Code session. The agent recorded it with `lervo knowledge instruction intake`, and the candidate became `review_required`. On the Mac, review was refused because WSL owns convergence for the repository. On WSL, the candidate did not exist yet, because the Hub exchange runs only during resident cycles. The refusal still claimed that WSL "already holds the candidate". The generated `AGENTS.md` route still said rules are captured "for owner review". The owner had already decided that they are not a review queue.

The ADR-0467 plan gate already admits only safe rules. A plan is `ready` only when:

- the owner stated the rule explicitly (`authority: explicit_user`);
- it is a directive for the whole repository that adds a rule;
- the scope is specified;
- risk is low, nothing conflicts, and confidence is high;
- the instruction catalog is complete.

Everything else stays `pending` or held.

## Decision

### The owner host applies owner-stated candidates

Each resident cycle on the convergence owner, or on a single host without Hub coordination, applies every stored candidate with `authority: explicit_user`. This runs after owner-turn capture and the Hub candidate exchange. It uses the existing apply path:

- the plan is rebuilt against the current instruction catalog and must still be `ready` with the same plan, rule, target, and bytes;
- the rule is written under `docs/instructions/generated/`;
- `knowledge.materialization.applied` is recorded;
- the resolution is published through the Hub exchange;
- on a Hub-coordinated owner, the file is committed as `Lervo Knowledge` for publication.

The recorded reviewer is `lervo-principal-proxy`. No owner or agent runs a review command.

- A candidate stays bound to the instruction catalog it was judged against. Owner rules applied after it do not stale it. Each apply records the catalog digest before and after, and the candidate stays valid when those recorded applies lead from its digest to the current one. Any other catalog change still stales it.
- On a Hub-coordinated owner, a candidate is settled only after its rule commit exists: the `applied` resolution is published and the candidate is removed. When the commit fails, for example on a held Git index lock, the written rule and its apply event stay, and the next cycle retries the commit before settling.
- A candidate that fails the rebuilt gate stays stored and is retried on the next cycle. A non-owner host never applies. It assesses its own turns and shares candidates through the Hub, and the owner host applies them after its next exchange.

`lervo knowledge instruction review` remains for rejecting a candidate or applying one by hand. Undoing an applied rule is an ordinary change to its generated file, or a new owner statement.

### Wording follows the decision

- The generated `AGENTS.md` route says Lervo captures owner rules and applies owner-stated rules automatically.
- A review refused on a non-owner host says that the owner host receives the candidate through the Hub exchange and applies it automatically.
- Instruction-capture attention lines name automatic apply and the principal proxy, never "tell the owner".

## Events, states, privacy, and failure meaning

- No event type or candidate field is added. `knowledge.materialization.applied` with `operation: durable_instruction_intake` binds the principal-proxy approval digest.
- Candidate, exchange, and privacy rules are unchanged from ADR-0467.
- A failed automatic apply is not recorded as a failure. The candidate stays, and the resident cycle continues.

## Verification

Focused tests must show:

- On the owner, an owner-stated candidate is applied and committed as `Lervo Knowledge`, and its `applied` resolution is queued for the Hub. A second cycle finds nothing to apply.
- On a non-owner host, nothing is applied, and the candidate stays.
- A candidate whose instruction catalog changed in another way is deferred and kept.
- Two candidates judged against the same catalog are both applied in one cycle.
- A failed commit keeps the candidate and publishes no resolution; the retry commits and settles it.
- The resident worker calls the apply step only on the owner path, and its failure does not fail the cycle.

Installed verification must show the owner's 2026-11-01 rule applied on the WSL owner without a review command, then present on the Mac after publication.
