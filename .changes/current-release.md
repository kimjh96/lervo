<!-- lervo-release package="@lervo/cli" version="0.47.6" schema="1" -->

## What's changed

- Make a knowledge publication run from the CLI ask the resident to take over its retry, so a pull request waiting on checks merges when they pass instead of stalling.
- Speed up the terminal prompt and Stop hooks: the current workstream is read through the event type index, and Stop finds its prepared context from the open-turn marker instead of reading the whole session history.
