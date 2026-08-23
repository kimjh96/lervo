# ADR-0133: User-Facing Codex–Claude Deliberation CLI

- Status: accepted
- Decision date: 2026-08-21

## Context

Deliberation schemas, runtime, and cross-review fixtures existed, but users could not select two provider roles and project verification suites from a repository. Free-form transcript concatenation cannot distinguish agreement, shared context, writing quality, and executed verification, and append-only monolithic documents are unsuitable for review.

## Decision

lervo deliberate assigns distinct Codex and Claude providers to proposal/decision and independent review/verification. It requires a topic and 1–16 project suites and runs at most two rounds. Review line one must be exactly the configured-language equivalent of Verdict: Approved or Verdict: Revision required; natural-language sentiment is never inferred as convergence.

Each proposal, review, revision, verification, and decision uses a new managed provider session. The opposite provider separately evaluates writing semantics in the publication language. Evaluation must be an exact JSON object covering every requested check with no extras, duplicates, fences, or contradictions. This does not claim comprehension or later use.

Each artifact emits context.published once and role-specific handoff.created records over the same content hash. Every receiving role must create fresh E2/E3 evidence in its next run. Provider receipts, sessions, and hidden reasoning are not shared.

After approval, all named suites actually run. run.completed and verification.completed coordinates must match managed-run source artifacts. Only all required passing suites plus a final decision yield converged. Exhausted review yields no_consensus; provider, writing, event, or artifact contract failure yields failed.

Short manifests and source files are atomically stored under .lervo/state/deliberations/<id>/ with owner-only permissions and separate lifecycles. Events exclude bodies, prompts, provider payloads, reasoning, and absolute paths. Human output hides internal coordinates; --json exposes structured coordinates. Exit codes are 0 converged, 2 no consensus, and 1 failure.

## Consequences

Users can run independent Codex–Claude review with evidence-backed verification without claiming shared hidden context. This version fixes two roles/providers; arbitrary topology, durable resume, and external-chat initiation remain separate.
