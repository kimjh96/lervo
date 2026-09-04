# ADR-0363: Checkpointed terminal workspace pause and liveness

- Status: accepted
- Date: 2026-09-04

## Context

A direct terminal could activate an exact worker workspace, but a successful Stop left that writer active. A later provider session could not continue the same assignment despite the prior turn recording a valid checkpoint. Conversely, treating a silent or old session as dead would risk two writers mutating the same checkout.

Codex and Claude adapters report native provider-session resume as unsupported. Repository continuation must not be mislabeled as restoration of provider conversation memory.

## Decision

Add `paused` to the provider-neutral workspace lifecycle. A successful worker Stop first revalidates the workspace, assignment, lease, writer, marker, scoped changes, and exact checkpoint. It then transitions `active -> paused` and clears the writer session. If checkpointing or pausing fails, Stop records an action-required isolation result and does not claim the writer was released.

A later prompt may transition `paused -> active` only after revalidating the same workspace generation, assignment lease, agent/provider authority, marker, host state, and path scope. The new writer has a distinct session digest. Prompt context labels this repository continuation as `resumed`; it remains unmanaged provider execution and does not claim native session or conversation resume.

Writer sessions record a bounded `lastSeenAt` observation. Repeated prompts from the current writer refresh it through an exact same-state transition. `lervo workspace inspect` classifies the writer as absent, recently observed, stale observation, or legacy unknown. Staleness never releases writer or assignment authority and proves neither process death nor provider termination.

Writer session IDs are domain-separated digests. Raw native provider IDs, prompt text, output, paths, and credentials do not enter shared lifecycle events. Coordination events retain the state transition and bounded reason; the checkpoint retains its existing path-private evidence.

## Consequences

- A cleanly stopped worker can continue in a fresh terminal session without sharing conversation memory or weakening the single-writer invariant.
- A crashed or silent active writer remains fenced until explicit recovery because no checkpointed pause exists.
- Runtime liveness is observable for managed workspaces but is not a general heartbeat for every root agent, managed provider process, Node, or unattended scheduler.

## Verification

Pure lifecycle tests must cover checkpointed pause and later activation. Liveness tests must cover recent, stale, legacy, and absent observations without authority release. Direct-terminal integration must use two provider sessions in one worker checkout, prove pre-Stop exclusion, post-Stop pause, and fresh-session resume, and retain outside-scope blocking.
