<!-- lervo-release package="@lervo/cli" version="0.59.0" schema="1" -->

## What's changed

- A long-lived process reuses the snapshot cache it last wrote while the file keeps the identity it wrote, instead of reading and checking it again on every prompt.
- A new project starts with its first commit so work can start at once, a new project that fails leaves no folder, and work in a project without a commit fails as repository_has_no_commit instead of a raw Git error.
- Add lervo project add (from a folder, a clone link, or a name alone, with git init and lervo init when needed) and lervo project location, so a project can be added in one command.
- Add lervo project show, rename, and mark set|clear: a project's display name and optional logo live in .lervo/project-profile.json beside the manifest, so renaming never stales a host's registry entry.
- Add lervo repository unregister: it removes this host's registry entry for a project, never its files, so the host's background knowledge maintenance and upgrades no longer reach it.
- An older installed CLI no longer puts its terminal hook runtime back over a newer one's, and a Stop no longer starts its worker from a binding older than the CLI that published the host runtime.
- Hiring a product owner in a project without that role now writes .lervo/roles/product-owner.json from the core's template first, so every project can hire one; an existing role file is never replaced.
- On macOS, Claude sign-in checks and stored-login runs find the keychain login again: the login environment keeps USER and sets CLAUDE_CONFIG_DIR only for a non-default directory, so a signed-in owner is no longer reported as signed out.
- Prompts read the checked-out branch from Git's files instead of running git symbolic-ref, falling back to Git for anything unusual.
- Report whether each provider CLI is signed in (provider.list signedIn) through the adapter's login inspection, and refuse to launch a hosted session with provider_login_unavailable when the provider says no one is signed in; an unknown state never blocks.
- The core link answers project commands (add, rename, mark set|clear|read, unregister, projects.location) and lists each repository's display name, mark, and root, so the ADE can manage projects through the core.
