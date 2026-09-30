# Provider runtime and activation validation

The runtime prepends its Node executable directory to the provider process `PATH`. This allows an absolute Codex launcher using `#!/usr/bin/env node` to run under a minimal systemd environment.

Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

Provider version preflight applies the same Node-directory `PATH` rule but exposes only `PATH` to the probe. Without this rule, a valid stored login can pass while the version probe incorrectly reports `probe_failed` for an `env node` launcher, preventing supervised owner decisions from starting. The login probe and actual provider process retain separate environment contracts.

Before activating a Node distribution that changes native provider arguments, run a bounded, no-session-persistence print-mode smoke check against each configured provider executable and output format. Claude `--print --output-format stream-json` also requires `--verbose`. A version or login probe alone does not validate this execution contract.
