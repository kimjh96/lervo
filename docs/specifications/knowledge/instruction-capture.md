# Owner-turn instruction capture

Status: `wired`
As of: 2026-10-05

This contract implements [ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) and the instruction-capture and conversation-decision part of [ADR-0457](../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md). It defines owner-turn intake, resident assessment, storage, review, and delivery to every provider.

## Pipeline

```text
terminal UserPromptSubmit ─┐                                  ┌─► exact-review candidate ─► owner review ─► docs/instructions/generated/
                           ├─► transient queue ─► resident ───┼─► held decision or rule (owner confirms or dismisses)
managed conversation turn ─┘   (no provider)     assessment   └─► nothing (none, personal preference, covered)
```

## Contract

- [Intake, assessment, storage, and events](instruction-capture/runtime.md)
- [Host parity and candidate exchange](instruction-capture/host-convergence.md)
- [Review, visibility, and evaluation](instruction-capture/review-and-evaluation.md)
