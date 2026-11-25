<!-- lervo-release package="@lervo/cli" version="0.51.0" schema="1" -->

## What's changed

- A linked worktree's prompts use the registered repository's knowledge snapshot instead of scanning their own, so a plain git worktree of a large repository records its turns and no longer waits for the hook deadline on every prompt.
- In a linked worktree, lervo terminal status, coverage, and budget, lervo knowledge instruction capture, and lervo application attention report the registered repository's evidence, and a status read no longer clears the checkout's workstream.
- Read event schema 12 in the CLI, the Node, and the Hub: terminal.turn.observed can record a turn that ended without a Stop hook, with its ending and a not_checked completion. Automatic writer activation stays at schema 11 until every reader has it.
- The resident process stops a hosted Claude session's running turn through decoder.interrupt, which it advertises to the ADE, and the conversation marks a stopped turn instead of reporting it as failed.
