# `execution.stages.observed`

Retains managed or unmanaged mode, an opaque work or terminal coordinate, nullable managed work ID, nullable terminal hook, observation and environment digests, repository profile, and at most 32 catalogued stage results.

Current managed producers use a null terminal hook; current direct producers use `UserPromptSubmit` or `Stop`. Historical sets without this additive field remain readable but project with an unavailable hook coordinate.

The canonical local CAS environment profile contains build, nullable adapter and provider, OS, architecture, Node, corpus counts when observed, cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names.
