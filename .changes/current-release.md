<!-- lervo-release package="@lervo/cli" version="0.60.0" schema="1" -->

## What's changed

- A conversation can start with chosen team agents (workspace.start participants); its session carries the writing agent as LERVO_AGENT_ID, and workspace.list reports each conversation's agents.
- A watched directory removed and created again before its event arrived now re-arms the watch, instead of leaving it on the removed directory.
- Every agent records whether it is the team's or Lervo's own (origin), and lervo upgrade records it once for agents hired before (ADR-0643).
- Lervo's knowledge and practice workers are hired with origin lervo, count against their own bound instead of the team's 256, and their retired records are pruned to the latest 32.
- The core link lists a project's agents, each marked as the team's or Lervo's own, with the roles it can hire (agents.list), and hires an agent for the owner (agent.hire).
