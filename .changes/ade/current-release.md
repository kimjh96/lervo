<!-- lervo-release package="@lervo/ade" version="0.11.0" schema="1" -->

Needs the Lervo CLI 0.63.0 or later.

## What's changed

- A conversation whose agent rested shows its history at once, from the index its session left, while the session opens again; the 100,000-item conversation first paints in about 100 ms.
- An agent's profile shows the paths it holds, with a Lervo CLI that reports them: the repository paths its conversations' claims and its assignments lease to it, whole and sorted.
- Streamed text keeps up with its arrival more closely: the reveal counts its 120 ms from when the text reached the window, so it never trails by two extra frames.
