# Input and result evidence

## Input binding

Before provider creation, the generic managed coordinator validates the exact bounded input CAS bytes and records envelope-version-3 `role.input.bound`. Its six required payload fields are `schemaVersion: 1`, `roleId`, `roleContractHash`, `inputContractId`, `inputArtifactHash`, and `inputByteCount`.

The event contains no question, source text, path, URL, credential, or provider output. It proves input binding, not selection, loading, injection, or use. Missing or corrupt bytes and an incompatible event writer stop startup.

## Result contract

The research brief is English Markdown with source footnotes and one final `lervo-research` provenance comment. The version-one manifest has `schemaVersion`, `kind: research.brief`, `inputHash`, and `sources`. Every cited source has its exact source ID, URL, retrieval time, and content hash.

Unknown citations, changed metadata, missing definitions, duplicate sources, stale retrieval, and substituted input hashes fail deterministic verification. The result is limited to 64 KiB.

## Installed verifier

The repository installs `role.research.artifact` with one `research-artifact` command: `node <exact-installed-cli-bundle> research verify --json`, working directory `.`, and only the three declared environment names `LERVO_RESEARCH_ARTIFACT_HASH`, `LERVO_RESEARCH_INPUT_HASH`, and `LERVO_RESEARCH_CAS_ROOT`.

The CLI checks the command and bundle path before provider startup and before verification. Its child environment binds the current Node directory and exact result/input CAS coordinates. Placeholder successful commands cannot stand in for this checker.

After provider shutdown and result capture, the existing verifier port receives the produced artifact. The checker opens CAS read-only and verifies actual input and result originals. Its output contains hashes and check IDs; source text and the brief remain in governed CAS artifacts.

Existing project-verification events bind the suite, repository revision, original command output, and result artifact. A failed check prevents normal run completion.
