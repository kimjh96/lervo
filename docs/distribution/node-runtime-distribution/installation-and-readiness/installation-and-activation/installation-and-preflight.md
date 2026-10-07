# Installation and preflight

Obtain the archive SHA-256 through a separate trusted channel and compare it using the platform SHA-256 tool. Extract into a new directory, then run:

```sh
node dist/bin.js --config <config.json>
```

Before activation, run the owner-only configuration and credential preflight:

```sh
node dist/bin.js --check-config <config.json>
```

Preflight performs no network or repository work.

Both commands first check every executable that the Node needs to start, such as each `deliberation.cliExecutable`. A missing executable fails with `configured_executable_unavailable`, and the message names the configuration field and the path. A configuration that `lervo upgrade` migrated names the host's stable CLI pointer, `<runtimes>/cli/current/dist/bin.js`, so removing an old CLI install does not break it ([ADR-0488](../../../../decisions/operations/services/0488-point-node-configurations-at-one-current-cli.md)).
