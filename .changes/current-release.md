<!-- lervo-release package="@lervo/cli" version="0.66.0" schema="1" -->

## What's changed

- A session that joined a conversation by a mention learns it reads only, and starts a conversation it leads for changes instead of asking for write permission.
- agent.context also answers the paths the conversations an agent leads changed and have not sealed yet, sorted, at most 100 with their total.
- Claim gate Git queries no longer crash with an uncaught EPIPE when Git exits before reading its input.
- lervo upgrade prunes event writer backups superseded more than 14 days ago and always keeps the rollback point
