<!-- lervo-release package="@lervo/cli" version="0.57.0" schema="1" -->

## What's changed

- Read a snapshot's HEAD from the repository's files, falling back to git for anything unusual, so each prompt and Stop snapshot spawns fewer git processes.
- Read event schema 13 in the CLI, the Node, and the Hub: execution.stages.observed can say how a terminal hook's answer was delivered, with its answer time or why it ran in its own process. Automatic writer activation stays at schema 12.
- Read owner rule files together instead of one at a time when a prompt prepares its applied rules and lists rule titles.
