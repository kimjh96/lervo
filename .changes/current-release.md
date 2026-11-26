<!-- lervo-release package="@lervo/cli" version="0.56.1" schema="1" -->

## What's changed

- Answer a served prompt as soon as its context is prepared and record it afterwards, so the context server no longer makes the provider wait for its records.
- Check Git ignore rules only for a turn's changed paths and reuse the Stop's lifecycle snapshot, so a changed turn's Stop no longer spends about 900 ms re-reading the repository.
- Fix the built CLI hanging at startup on an import cycle that the lifecycle snapshot reuse introduced, by moving the snapshot hand-off into its own module.
- Name each image mark by the SHA-256 of its bytes, so the ADE finds the image its session host kept, also in a conversation read back from Claude Code's transcript.
- Store each prepared prompt snapshot once under its content hash, so a prompt writes a small pointer instead of rewriting megabytes, and retained snapshots shrink from about 140 MB.
