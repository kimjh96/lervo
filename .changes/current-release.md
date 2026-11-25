<!-- lervo-release package="@lervo/cli" version="0.50.0" schema="1" -->

## What's changed

- A terminal repository snapshot that runs out of time keeps the hashes it computed, and workspace start warms a new worktree's snapshot, so ADE sessions in large repositories record turn evidence.
- A terminal session or Lervo command in a linked worktree of a registered repository records its evidence, owner-rule captures, plan, and workstream in that repository.
- Every terminal prompt takes compact context; the unused opt-in retrieval mode and its hidden provider query call are removed.
- lervo upgrade now activates event schema 11 once every configured reader, the Hub included, reads it, so hosted ADE sessions record their turn usage in resource.usage.recorded.
- The resident Lervo process records each hosted turn's usage, per result and model, once a repository's writer selects event schema 11.
