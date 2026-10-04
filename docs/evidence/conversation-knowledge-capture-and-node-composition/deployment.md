# Resident knowledge host and deployment

## Knowledge host selection

`apps/node-runtime/src/deployment-knowledge.ts` selects the supervision owner's reasoning provider when configured. For storage writer versions of at least 4, it also loads convergence delegation and considers its first provider as a fallback. If the selected value is neither Codex nor Claude, it returns a no-op stopper. A provider executable override comes only from supervision runtime-readiness configuration.

The helper forwards storage, artifacts, signal, and optional worker entry to the knowledge loop. Delegation validation and loop enforcement require separate source evidence.

## Deployment composition

`apps/node-runtime/src/deployment.ts` validates configuration and requires a physical, nonsymlink repository directory and `hubSyncEnabled`. This entrypoint does not establish no-Hub execution; no-Hub acceptance must identify another host path.

Startup prepares project storage, opens work admission, loads credentials, initializes health, and composes configured remote control, transports, conversation services, and supervision. Remote-command configuration and executor/policy ports must be supplied together.

Conversation and remote-control composition receive the admission drain. Knowledge-loop startup here receives an abort signal but no explicit drain parameter. This file alone cannot prove background knowledge work participates in every upgrade fence.

The deployment run callback starts an event watcher, then the knowledge loop, and optionally a supervision result-branch loop before entering outbound synchronization. The result loop is configured only when a worker workspace exists. Publication callbacks report branch results; branch publication is not target integration.

## Shutdown and evidence boundaries

The synchronization `finally` awaits knowledge shutdown, awaits result-loop shutdown, then stops watching. These finalizers are sequential and not independently guarded: rejection by an earlier stopper can prevent later calls. Loop setup precedes this `try`, so setup-failure cleanup requires separate verification.

Startup's outer catch stops admission and independently attempts supervision, conversation, admission, remote-control, and event-store cleanup, aggregating cleanup failures as `startup_failed`.

Credential reload callbacks and trust replacement remain separate from knowledge processing. Configuration composition, service health initialization, stored candidates, and empty queues establish neither completed convergence nor production document-write activation.
