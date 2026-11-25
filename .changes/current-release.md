<!-- lervo-release package="@lervo/cli" version="0.52.0" schema="1" -->

## What's changed

- A terminal turn that ended without a Stop hook, such as one the owner interrupted in the terminal or the ADE, is recorded at the session's next prompt or start with how it ended, its repository change, and its skill assessment, once the writer selects event schema 12.
- Hosted Claude sessions in the ADE run with Claude Code's auto memory off, so owner rules reach Lervo instead of a memory every worktree shares; the owner's own settings are unchanged.
- Repository upgrades activate event schema 12, which records how a terminal turn ended when no Stop hook ran, once every configured reader reads it.
- The resident process records the usage of turns a hosted session's decoder decoded before the session host named the session, once it is named, instead of losing it.
