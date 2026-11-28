<!-- lervo-release package="@lervo/ade" version="0.14.0" schema="1" -->

Needs the Lervo CLI 0.70.0 or later.

## What's changed

- A conversation follows every member's session, so members who work in their own worktrees show their work and working status in it.
- A new conversation's first message reaches every agent it mentions, who join it as members, as any later message of the owner's does.
- A new project role's permission menu reads What it can do, so it reads as what the role's agents may do rather than as a name.
- Conversations can be renamed from the header or sidebar menu and pinned to the top; a failed agent list retries and never shows another project's agents; the hire menu and agent profile drop unused parts; diagnostics keep the core's failure code.
- Hiring opens a sheet that asks for the agent's nickname and its role, and can add a new project role from a template; a project role is edited or removed from its own sheet, and an agent's profile moves it to another role.
- Scrolling back through a long conversation no longer jumps back and forth: the list keeps the reader's item in place in one step, and code blocks and tables get closer height estimates.
- The offer to restart an older session host wraps in the sidebar instead of ending its sentence in an ellipsis.
