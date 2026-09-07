# Cross-provider continuation

Continuation preserves the verified workstream identity, not a provider conversation. Installed acceptance must:

- Use distinct run, Lervo session, provider, and provider-session coordinates.
- Load and inject the exact current workstream revision.
- Bind both completed runs to that workstream and their verified result digests.

A changed current projection must fail before provider creation. No continuation evidence implies native provider-session resume, conversation-memory transfer, or semantic provider reliance.
