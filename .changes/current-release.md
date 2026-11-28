<!-- lervo-release package="@lervo/cli" version="0.68.1" schema="1" -->

## What's changed

- A hosted conversation no longer shows a bare Yield line when the agent waits for its background work; the agent's own words already say what it waits for.
- A hosted session's shell line that runs a lervo command among other commands now carries its Lervo call, so the ADE shows what Lervo did beside the other commands.
- A project without its own Hub credential never borrows another project's token; without Hub sync it is maintained standalone, and otherwise one notice names the credential to issue.
- A repository without a verification suite now gets the default lervo.default.knowledge suite when its knowledge delegation is seeded, so background knowledge maintenance starts for new projects.
- A shell line reads as Lervo's work when input is piped into a lervo command, when the call sits in a loop or after a here-document, and a command group alone reads as a help lookup.
- Agent and role commands in a linked worktree, such as an ADE workspace, resolve the roles the main checkout keeps, so a template role written on a first hire no longer fails every agent command there.
