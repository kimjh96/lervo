<!-- lervo-release package="@lervo/ade" version="0.12.0" schema="1" -->

Needs the Lervo CLI 0.66.0 or later.

## What's changed

- A conversation shows a quiet line when its lead answered another agent in a different conversation, naming both agents and opening that conversation.
- Agents chosen for new work in one project no longer go with new work in another project after a switch, and a refused start names the core's reason.
- An agent's profile lists, under the paths it holds, the paths its conversations changed and have not sealed yet.
- An agent's profile scrolls when it is taller than the window, so what it learned, the paths it holds, and Pause agent stay reachable.
- Removing a workspace explains two new refusals: a change still waiting to be integrated, and a checkout that was moved or switched to another branch.
- The turn summary card shows how many rules Lervo gave the agent for the turn, such as 2, or 2 of 14 when some did not fit.
