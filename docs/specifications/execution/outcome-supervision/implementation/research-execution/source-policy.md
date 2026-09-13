# Repository source policy

The user-owned `.lervo/research/source-policy.json` has exactly ten fields: `schemaVersion: 1`, `kind: research.source_policy`, `policyId`, `version: 1`, `projectId`, `allowedPaths`, `maximumSources`, `maximumSourceBytes`, `maximumAgeMs`, and `allowNetwork: false`.

One to eight explicit regular source files must be inside the task's expected paths. Source paths exclude hidden segments, traversal, and symlinks. Each source is limited to 32 KiB; the complete prepared input is limited to 128 KiB. Retrieval age is bounded by the policy, from one second to one day. Policy loading and source reading reject invalid UTF-8, changed files, unavailable originals, and project mismatch.

The input contract `research.inputs.v1` contains the question, repository source constraints, complete policy and its hash, role contract hash, and captured sources. Every source has an ordinal ID, repository-relative path, URL, retrieval time, raw content hash, and text. Its URL, `lervo-repository://<projectId>/<encoded-path>`, identifies a repository source, not a fetched network resource.

Preparation adds ephemeral observed documents to the managed context registry and binds the policy and sources to the required `research.source-policy` rule. It preserves user-owned source files and registered document identities. Required E3 context delivery remains independently observed.
