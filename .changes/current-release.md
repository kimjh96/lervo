<!-- lervo-release package="@lervo/cli" version="0.47.7" schema="1" -->

## What's changed

- ADE workspaces start from the fetched upstream tip of the default branch and carry the knowledge commits the resident has not published, never a possibly stale local checkout; retiring deletes a branch only when every commit beyond upstream copies a held patch.
