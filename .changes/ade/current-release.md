<!-- lervo-release package="@lervo/ade" version="0.2.0" schema="1" -->

Needs the Lervo CLI 0.43.0 or later.

## What's changed

- End a native session's provider with SIGTERM before SIGKILL, so Claude Code runs its SessionEnd hook, and report each provider exit to a Lervo core that records the ends hooks miss.
