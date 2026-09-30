# Uncertain-effect diagnostics

When an effect ends `uncertain`, the Node journal also receives:

`Lervo supervision effect uncertain (<actionKind> <effectContract>): <error name>: <first 400 characters of the message>`

For a managed dispatch without canonical dispatch evidence, the message ends with the worker CLI's own bounded failure reason and message, read from its last standard-error line. Canonical attention retains only bounded reason codes.

This line is host diagnostics, not evidence. It proves neither non-start nor the cause of a later supersession.
