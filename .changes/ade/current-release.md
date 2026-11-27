<!-- lervo-release package="@lervo/ade" version="0.13.0" schema="1" -->

Needs the Lervo CLI 0.67.0 or later.

## What's changed

- A workspace with uncommitted changes can be removed from its header with Remove with changes, which asks again and keeps a copy of the changes for up to 14 days.
- Opening a conversation whose lead answered in other conversations no longer shows those lines first and then the history settling to the end; the conversation appears once, already at its end.
- Opening the conversation shows in the middle of the view on one line, instead of against its top edge and wrapping while it appears.
- Removing a conversation's workspace also stops the sessions of agents that joined it, which made the core refuse with a process still running in the workspace.
- Renaming an agent or a project, choosing an agent's model or effort, pausing an agent, and clearing or choosing a mark show at once, instead of showing the old value again until the core answers.
- Show in Finder on a project opens the project's own folder, instead of its parent folder with the project selected.
- The first run greets with the Lervo mark and Welcome to Lervo on the whole window, offers Open Folder, Clone Repository, and New Project as one group, and folds the empty sidebar away; it no longer shows the usual start screen first when the projects were removed outside the ADE.
- The header's removal steps and every wait stay on one line, instead of wrapping for a moment as their place resizes.
