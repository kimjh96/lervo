# ADR-0133: User-Facing Codex–Claude Deliberation CLI

- Status: accepted
- Decision date: 2026-08-21

## Context

Deliberation schemas, runtime, and cross-review fixtures existed, but users could not select two provider roles and project verification suites from a repository. Concatenated free-form transcripts cannot distinguish agreement, shared context, writing quality, and executed verification. Append-only monolithic documents are also unsuitable for review.

## Decision

`lervo deliberate` assigns distinct Codex and Claude providers to proposal/decision and independent review/verification. It requires a topic and 1–16 project suites and permits at most two rounds. The first review line must be exactly the configured-language equivalent of `Verdict: Approved` or `Verdict: Revision required`; natural-language sentiment never establishes convergence.

Each proposal, review, revision, verification, and decision uses a new managed provider session. The opposite provider separately evaluates writing semantics in the publication language. Evaluation must be an exact JSON object covering every requested check, without extras, duplicates, fences, or contradictions. This does not claim comprehension or later use.

Each artifact emits `context.published` once and role-specific `handoff.created` records over the same content hash. Every receiving role creates fresh E2/E3 evidence in its next run. Provider receipts, sessions, and hidden reasoning are not shared.

After approval, every named suite runs. `run.completed` and `verification.completed` coordinates must match managed-run source artifacts. Only all required passing suites plus a final decision produce `converged`. Exhausted review produces `no_consensus`; provider, writing, event, or artifact-contract failure produces `failed`.

Short manifests and source files are stored atomically under `.lervo/state/deliberations/<id>/`, with owner-only permissions and separate lifecycles. Events exclude bodies, prompts, provider payloads, reasoning, and absolute paths. Human output hides internal coordinates; `--json` exposes structured coordinates. Exit codes are 0 for convergence, 2 for no consensus, and 1 for failure.

## Consequences

Users can run independent Codex–Claude review with evidence-backed verification without claiming shared hidden context. This version fixes two roles and providers; arbitrary topology, durable resume, and external-chat initiation remain separate concerns.
