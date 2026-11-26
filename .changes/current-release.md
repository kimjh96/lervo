<!-- lervo-release package="@lervo/cli" version="0.59.2" schema="1" -->

## What's changed

- lervo project location and project add refuse a projects location inside a Git work tree, so a checkout at ~/lervo, which macOS also reads as ~/Lervo, never receives new projects.
- The context server keeps the checkouts it served in the last 30 minutes warm, preparing the latest one every idle minute and the remembered ones right after it starts.
