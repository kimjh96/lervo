# Bounded offline replacement

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; fleet health is not thereby ready.

During registered replacement, the readiness window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready Hub-dependent component has that exact retryable code.

Replacement readiness judges regression, not perfection ([ADR-0475](../../../../decisions/operations/services/0475-judge-node-replacement-readiness-by-regression.md)). Before the service operation, apply reads the predecessor's snapshot as a baseline. A non-delivery component (`workspaceCoordination`, `remoteControl`, `conversation`, or `supervision`) may remain `unavailable` only with its baseline status and failure code. The receipt lists it in `carriedConditions`. `sync` and `workstreamReplication` never carry a failure over.

The readiness window lasts sixty seconds past the latest startup progress, bounded at 600 seconds. Progress means a first fresh snapshot, more accepted components, or an advancing `updatedAt` heartbeat in a `starting` snapshot from the first process seen `starting` ([ADR-0480](../../../../decisions/operations/services/0480-defer-node-cache-warmups-past-readiness.md)). A later `starting` snapshot from another process ends heartbeat progress.

First onboarding has no baseline. It and every authentication, configuration, integrity, divergence, stale, mixed, unknown, or newly appearing failure still require complete readiness or fail closed. A timeout names each blocking component with its observed and baseline state.
