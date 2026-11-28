<!-- lervo-release package="@lervo/ade" version="0.13.3" schema="1" -->

Needs the Lervo CLI 0.68.1 or later.

## What's changed

- A run of tool lines reads as one block, with the same room before and after the messages around it, instead of a message hugging the run above it.
- A shell line that runs a Lervo command among other commands reads as what Lervo did, then the other commands as code, instead of the whole raw command line.
- A tool call with nothing to show, such as TaskStop, lines up with the other tool lines, its name in the same place and face, instead of a plain line of its own.
- An agent that joined a conversation shows its work in the sidebar, the conversation list and the project switcher, as the agent that leads it does.
- Jump to latest rises in place at the center instead of starting right of center, and a change of speaker keeps more room above it than any step within one agent's turn.
- Switching between agent profiles keeps the leaving profile's model and effort as they were, instead of showing the first model and Low while it fades.
