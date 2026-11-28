<!-- lervo-release package="@lervo/cli" version="0.68.0" schema="1" -->

## What's changed

- Every repository now coordinates its ADE conversations by default, and an owner-only disabled file in the coordination home closes the gate.
- Knowledge migration no longer stops on large documents: documents over 256 KiB are split byte for byte before normalization, normalization runs in batches within its ceilings, and a moved document is reviewed by hash and rewritten lines.
- Migrating a continuation document into the workstream sends the unchanged document to the independent review as evidence, so the review no longer rejects every plan for missing source bytes.
- Splitting large documents during knowledge migration reuses the migration's repository scan instead of scanning the repository a second time.
