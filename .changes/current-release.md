<!-- lervo-release package="@lervo/cli" version="0.70.0" schema="1" -->

## What's changed

- A project can add, edit, and remove its own roles from Lervo's templates with lervo role, move an agent to another role, and name hires like people; an agent changes roles or hires only when its role grants that authority.
- Every member of a conversation works in it from its own worktree: a mentioned agent gets a member workspace with its own branch and claims, and its session writes there and keeps its context for the life of the conversation.
- The core link answers workspace.rename and workspace.pin, keeping the owner's conversation title and pin host-side, and workspace.list shows the owner's title over the workstream title and lists pinned conversations first.
