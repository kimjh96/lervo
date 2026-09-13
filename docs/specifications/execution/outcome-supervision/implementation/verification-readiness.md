# Supervision verification-definition readiness

## Trusted pins and inspection

The Node supervision factory accepts `runtimeReadiness.verificationSuiteHashes`: a trusted host map from exact suite IDs to canonical `verificationSuiteHash` values. It snapshots pins with other runtime configuration before opening storage. At most 32 pins are allowed, with bounded IDs and SHA-256 hashes. Proposed actions and provider output cannot supply or refresh this configuration. Hosts must review changed definitions and use the same pinned suites for later verification effects.

Every responsibility suite requires a pin. Each dispatch, retry, and owner-execution preflight uses `@lervo/verification` to load the actual control-repository definition, compare its canonical hash, resolve every command working directory, and reload the definition to detect changes during inspection. The loader retains its 64 KiB file limit, safe directory and file reads, exact filename/ID matching, and suite schema and semantic validation. Suites contain at most 32 ordered commands. Working-directory validation rejects missing directories and symlink escapes.

The observer runs no command, reads no named environment-variable value, and creates no verification result, event, artifact, migration, or cache. Control-repository definition inspection proves neither worker-checkout readiness nor command executability or permission. Executable version observations remain a separate readiness input.

## Evidence and failures

Only an existing passed application verification check with evidence can be supplemented. Any of the following makes that check `unobserved` with null evidence:

- Missing configuration or pins.
- An empty or oversized suite set.
- Missing or malformed definitions.
- Changed hashes.
- Unsafe layout or working directories.
- Inspection errors.
- An elapsed interval outside zero to five seconds.

Negative, not-required, missing, and missing-hash application evidence is never promoted. The original observation time remains unchanged.

A successful combined evidence hash binds prior application evidence and the exact suite ID/hash set. Readiness records exclude raw commands, arguments, environment names and values, working directories, file contents, and native errors. The observer uses the existing readiness disposition and adds no event or durable state format.

Pins remain fixed across both execution preflights: a valid replacement definition cannot silently become the reviewed suite. Inspection is not an atomic filesystem transaction. At its own commit boundary, the effect adapter must recheck actual worker sources, pinned definitions, working directories, environment policy, and execution authority. Only actual verification results can prove command success or artifact acceptance.

## Validation and remaining work

Real suite files and disposable repositories cover exact pins, absent pins or files, invalid YAML/schema, changed definitions, symlinked files, missing working directories, elapsed bounds, preserved negative evidence, and definition replacement between execution preflights. A command with a sentinel write remains unexecuted during successful inspection.

Actual authentication and task-tool permissions, worker context delivery, research-source policy, verification execution, and budget and process observations remain open. Responsibility installation still requires exact claim/revision ordering and live-lease reconciliation. This observer activates no production supervision loop.
