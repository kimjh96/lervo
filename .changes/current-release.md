<!-- lervo-release package="@lervo/cli" version="0.54.0" schema="1" -->

## What's changed

- A repository's committed hook launcher hands each hook to the host's launcher when it is trusted and at least as new, so launcher changes reach every repository through the CLI install; served prompts are counted by launcher.
- Answer turn.summary with what the core recorded about each turn of a hosted session.
- Recognize the Lervo commands a hosted agent runs, so the ADE shows them as what Lervo did.
- Report how many documents a hosted agent's knowledge search found and which, for the ADE's search line.
- Run the resident context server from the host release follower, so every host, including one without a knowledge host service, serves prompts.
- The context server now serves prompts on the Mac: unset variables compare as their defaults, so the service's explicit state directory matches. It starts only runtimes with the server mode and counts outcomes in context-stats.json.
- Walk the repository snapshot concurrently, keeping file order, the entry and deadline bounds, and stopping every read at the first failure, so prompt hooks spend less time capturing.
