<!-- lervo-release package="@lervo/cli" version="0.56.0" schema="1" -->

## What's changed

- Carry images in a hosted Claude session's messages: the core link takes them for decoder.send, advertises decoder.images, and Claude transcripts read back image marks.
- Never drop a prompt over hook input Lervo cannot read: empty prompts are accepted, long prompts are cut to 64 KiB, and rejected input exits 0 with a recorded failure.
- Read event types through their index and the current workstream newest first, so a prompt hook no longer scans or decodes the whole event history.
