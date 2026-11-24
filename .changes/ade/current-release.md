<!-- lervo-release package="@lervo/ade" version="0.4.3" schema="1" -->

Needs the Lervo CLI 0.43.0 or later.

## What's changed

- The session host accepts the account of a workspace's base that Lervo CLI 0.47.7 and later report when a workspace starts.
- The session host follows a CLI upgrade: before its next workspace start or list, it replaces its resident Lervo process with one from the newly installed CLI, never during a turn.
- When Lervo starts work without something, such as from the local branch because the upstream could not be fetched, the started workspace says so above its working line.
