<!-- lervo-release package="@lervo/cli" version="0.23.5" schema="1" -->

## What's changed

- A reviewed repository layout plan is now asked as one owner decision with a recommendation, shown in the plan, attention, health, and lervo upgrade, accepted or declined with one command each; a scope proposal over the delegation root limit is no longer asked.
- Discord conversation failures without an error code now record a stable HTTP failure code or the file and line that threw, never message content, so residual Discord errors can be located.
- Document freshness candidates now get an independent no-capability Tier 0 cross-check, so agreed Lervo-managed statement hunks apply without the owner and contested candidates are rejected and regenerated once.
- Document freshness no longer treats a path mention that the repository never tracked, such as a fixture or example name, as a removed reference, so it creates no finding and no forced (removed) edit; deleted paths behave as before.
