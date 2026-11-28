<!-- lervo-release package="@lervo/cli" version="0.67.1" schema="1" -->

## What's changed

- A claim or a turn's reconciliation Lervo could not finish now refuses the write or blocks the turn with a visible reason, instead of letting the change pass unchecked.
- lervo project add, and project.add from the ADE, package the repository skills of a folder that already has Lervo, such as a clone, as lervo init does, so its knowledge stages need no lervo upgrade first.
- Removing a workspace with its changes keeps the copy in a large repository too: the gitlink check streams the tree listing, which ran past Git output limits in a repository of thousands of files.
- Retiring a workspace waits up to 5 seconds for processes to leave its worktree before it refuses with workspace_in_use, so removing a conversation right after its turn ends no longer fails.
- The host follower upgrades a repository registered after its last pass within one poll, instead of waiting for the next release.
