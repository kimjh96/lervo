# Asynchronous conversation knowledge lifecycle

Status: `in_progress`
As of: 2026-09-27

## Outcome and current boundary

Repository agents own source-bound canonicalization and knowledge convergence without adding global lifecycle work to live conversation responses. [ADR-0427](../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md) defines the evidence and authority boundary; [ADR-0433](../../decisions/knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md) extends obligations to managed runs and terminal turns.

Installed version 3 provides durable change/outbox capture, bounded generic review, retry, and atomic resolution/acknowledgement. Local version 4 implements autonomous canonical integration and lifecycle convergence. A private installed Codex canary verified no-Hub operation, restart, and last-edit discovery. Fleet activation and busy installed conversation acceptance remain open.

The [2026-09-27 installed audit](../../evidence/quality/background-knowledge-convergence-audit.md) observes 38 generic change jobs across AXLI and Arca-next, all resolved as attention or pending review, with no current outcome. Historical activation constraints remain acceptance requirements; they do not imply that the current Node lacks its version-3 background path.

The [autonomous convergence roadmap](autonomous-background-convergence.md) owns implementation, remaining acceptance, baseline recovery, independent normalization review/apply, and installed completion gates. This document retains the conversation foundation and historical evidence.

## Installed version-3 capture and hosts

For changed terminal Stop and managed run units, a version-3 writer appends `repository.change.completed` and its `knowledge:repository` job together. Conversation repository work selects `pending_background` from the writer coordinate and appends the generic change/job in its completion transaction. Replays create no second job; unchanged units create none. Older or unreadable writer coordinates retain synchronous completion.

The manifest binds every changed path. Above 64 published paths, the event carries only the count and the generic worker records attention instead of reviewing a truncated subset. Untracked Git-ignored files and known Lervo projections are excluded. Python cache paths still reached review in the installed AXLI sample, so this exclusion does not fully demonstrate governed source selection.

`lervo knowledge worker --once --provider <claude|codex>` hosts the core owner under a repository process lock. Terminal Stop and managed run completion launch it detached. A Node configured with owner reasoning hosts the same owner in a bounded event-driven loop, using a 60-second wakeup and the configured provider executable. Hosts share operational ownership and job leases.

The generic owner reviews source changes in a no-capability process. Implementation-only work becomes `current` only after read-only knowledge inspection passes; the host never applies migration or refresh. A canonical verdict attempts to register a typed candidate and settles `pending_review`. Missing before-bytes, lifecycle debt, or a needs-review verdict settle attention. Transient failures retry with bounded backoff and a 16-attempt ceiling.

Canonical candidates surface through terminal attention and Discord repository-work instructions. A later authorized agent changes the canonical target and promotes by exact hash or rejects the candidate. Resolution does not currently schedule separate convergence completion. Background normalization likewise stores candidates for later turn-owned review/application, rather than independently draining the full lifecycle.

Owner-accepted supervised checkouts are exported to create-only `lervo/results/<assignment>` branches. A later observed merge queues its knowledge job. The seal/integration lifecycle is not composed into this automated background path; a result branch does not prove target-byte integration.

## Historical installed evidence

A Mac terminal Stop on the version-3 writer appended its change and job atomically. The detached worker settled `pending_review` 18 seconds later; the candidate was promoted after its canonical document was updated. Stop took 5.6 seconds versus 4.5 seconds on version 2. This proves one terminal capture/review/promotion journey, not autonomous repository-wide currency or installed latency under a busy converging worker.

The fleet audit now observes installed Discord generic jobs. An independently measured prompt-to-publication journey followed by canonical integration, normalization, and verified currency remains unobserved. A healthy Node or empty queue cannot substitute for this acceptance.

## Reusable richer foundation

Earlier conversation-specific modules provide bounded source-coordinate manifests, read-only queue reconciliation, safe source preflight, separate deterministic agent-assignment provenance, and read-only access modes that permit live writers.

They also provide exact leased capture of Git and dirty source into memory, a physically isolated no-capability review boundary, applicable instruction hierarchy, hash-verified canonical context, and non-success settlement fenced by both agent and queue leases. Missing manifests, invalid evidence, unavailable historical source, and legitimate retry exhaustion have bounded failure meanings.

These are reusable contracts, not proof of composition in the active generic worker. The audit identifies weaker active behavior: four-commit before-byte search, root-only truncated instructions, no post-review source recheck, and possible null-candidate pending review. Repair and reuse must precede automated document writes.

## Remaining acceptance

- [ ] Preserve exact source capture, job idempotency, capacity recovery, and restart across all entry points.
- [ ] Prove prompt publication stays independent of lifecycle work, with truthful pending state and no knowledge-success wording.
- [ ] Compose independent assigned review, scoped canonical integration, exact promotion, normalization review/apply, and ordered lifecycle verification.
- [ ] Recover baseline debt and acknowledged unfinished jobs without changing historical resolutions or inventing former bytes.
- [ ] Close source/context drift and null-candidate settlement gaps before verified current outcomes.
- [ ] Prove provider/resource bounds, user-owned conflict safety, recovery during apply, and no-Hub execution.
- [ ] Separately measure an installed Discord result and subsequent convergence, including idle completion without another human turn.

Detailed gates are in [autonomous background convergence](autonomous-background-convergence.md). Local verified gates are checked there; remaining installed gates retain their unobserved scope.
