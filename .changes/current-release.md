<!-- lervo-release package="@lervo/cli" version="0.35.0" schema="1" -->

## What's changed

- Add lervo application serve --stdio, the resident Lervo process that the ADE session host starts, which runs workspace commands and decodes Claude Code's structured stream for the native conversation.
- Add lervo workspace start and lervo workspace open, which create a workspace from an instruction and prepare hosted Claude Code and Codex CLI launches for the Lervo ADE.
- Validate core-link requests in lervo application serve with a validator compiled at build time, so the CLI bundle carries no schema compiler and keeps only its reviewed dependencies.
