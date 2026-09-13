# Stored-login contexts

Native Codex and Claude adapters accept an explicit stored-login context. They snapshot its isolated process environment at construction and pass it to the app-server or SDK process. Parent API keys and other environment values are not added to that explicit environment. Omitting the option preserves existing process-environment behavior.

A Codex stored-login context is incompatible with the separate Responses API transport. The Node adapter factory forwards the same explicit context. This option does not establish remote authentication or task readiness by itself.
