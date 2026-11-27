<!-- lervo-release package="@lervo/cli" version="0.66.2" schema="1" -->

## What's changed

- A Bash command that makes a directory with mkdir no longer claims that directory, so a file another conversation holds below it no longer refuses every new file there; the files written into the new directory are claimed one by one.
- A claim refused for an overlapping ancestor or descendant now names the path the holder actually holds, with the requested path for context.
- A command run in a linked worktree whose repository this process's registry lacks, such as one run by hand beside the ADE, now records into the main checkout when it keeps its event store, and otherwise warns that the worktree's own evidence is deleted with it.
