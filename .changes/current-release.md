<!-- lervo-release package="@lervo/cli" version="0.55.0" schema="1" -->

## What's changed

- Decode a Claude Code compaction as a notice, and keep its summary for the model out of rebuilt conversations.
- Read a slash command in a Claude Code transcript as typed, so a reopened ADE conversation shows the command instead of its markup.
- Run native hosted Claude sessions in bypass permission mode, so the owner's other sessions can message them.
- Serve Stop hooks over the resident context socket, with the session's environment and umask, detached workers started by the hook's client, and a server that finishes the hook in flight before it stops.
- Share the workspace title rule with the ADE, so it shows the same title while a workspace starts.
- Show a message another session sent a hosted session as that session's message, live and in rebuilt conversations.
