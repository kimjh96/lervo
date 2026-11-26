<!-- lervo-release package="@lervo/cli" version="0.61.0" schema="1" -->

## What's changed

- Agents can join a conversation: room.join prepares a team agent's own read-access session in its worktree, room.route names the agents an owner's turn mentions, and workspace.list reports each conversation's participants and sessions.
- Agents mention each other in a conversation: when an agent's turn ends, the core delivers a turn to each team agent it mentions, returns answers, pauses at the exchange budget, and tells each agent session who it works with.
- Answer a prompt the context server cannot take from the checkout's cached base in milliseconds, and record it as event schema 14, the new writer target.
- In a conversation, naming the agent that asked is the answer to it, so an exchange ends there instead of bouncing back and forth.
- Leave an interrupted turn for the next prepared prompt after a cached-base answer, record each delivery once under a random identity, and restart the server only when base preparation left reads running.
- Read event schema 14 in the CLI, the Node, and the Hub: terminal.context.base_delivered records a prompt answered from the cached base. Automatic writer activation stays at schema 13.
- room.join never asks the session host to read the lead's transcript into a joined agent's session, which keeps its own history.
