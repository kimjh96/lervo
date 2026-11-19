<!-- lervo-release package="@lervo/cli" version="0.27.2" schema="1" -->

## What's changed

- Shell-quote every path in commands Lervo prints to paste: the replica restore undo, its cycle report, and each lervo repository release --root line. An effect notice no longer cuts a long undo command; one past 2048 characters is refused.
