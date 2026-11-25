<!-- lervo-release package="@lervo/cli" version="0.53.0" schema="1" -->

## What's changed

- Decode what each hosted tool call acted on and showed, as a bounded tool detail in the native conversation.
- Prompt hooks are answered by a context server the host resident service keeps running, so a prompt no longer starts Node and loads the hook runtime; any failure falls back to the in-process hook. About half the end-to-end time on a large repository.
- The context server also compares LERVO_WORKSPACES_HOME and XDG_CONFIG_HOME, so a session that sets either is never answered with the server's value.
- The context server keeps serving after a degraded prompt: it waits for the work a failed or late stage left running instead of restarting, and restarts only when that work does not settle.
