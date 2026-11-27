<!-- lervo-release package="@lervo/cli" version="0.64.0" schema="1" -->

## What's changed

- A conversation whose coordination is active writes Lervo's claim handler into its worktree's local Claude Code settings, and a reopened claiming conversation adds the handler when its worktree lost it. The coordination gate stays closed in this release.
- A shell command's redirection that duplicates or closes a descriptor, such as 2>&1 or >&2, no longer counts as writing a file named after it, and >|, 1>, and &>> redirections now count as writing their file.
- A turn's end adds a quiet line for each path its claims reconciliation left unresolved, naming who holds it, and counts the rest past three.
- agent.context also answers the repository paths the agent holds under a live write lease, sorted, at most 100 with their total.
- Bind an ADE conversation's lead lease and first workspace generation at start under event schema 16
- Claim a conversation's paths before the first write and refuse conflicts with the holder named, behind the coordination gate
- Hold knowledge publication merges while this host's CLI release follower is paused, so a release train's preparation is not superseded mid-train.
- Opening an agent's profile only reads: agent.context no longer creates the repository's workforce home or its assignments folder.
- Reconcile conversation claims at Stop and session exit, hold changed paths, and regenerate leases
- The claim log can list a conversation's claims that reconciliation left unresolved, so a later reconciliation retries them and they can become resolved.
