# Context, reference, and turn evidence

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain:

- Opaque IDs and domain-separated request and retrieval digests.
- Typed grounding status, workflow/source/subject/provider identifiers, and bounded reason codes.
- Candidate counts, repository-relative coordinates, hashes, assurance, freshness, lifecycle state, and reference availability.
- Prepared and final repository revisions and the derived changed flag.
- Final verified workstream ID, revision, and snapshot hash.

Direct unmanaged prompt preparation uses grounding reason `unmanaged_terminal_retrieval_only` with empty semantic-action coordinates. The preparation event distinguishes candidate selection, hash-bound loading, hook preparation, provider injection (`unobserved`), and provider use (`unknown`). Hook-side preparation never establishes delivery or use.

For a direct root session, `lifecycleStatus: action_required` may coexist with `completionResult: allowed`: the former is an observed repository finding; the latter means the audit did not claim authority to block provider availability. Attached-worker isolation may still record `blocked`. Empty hook success after an internal failure creates neither an event nor inferred success.

`terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition, optional completed-deliberation ID, and time.

These terminal events exclude prompts, retrieval-query text, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations do not prove internal reasoning.
