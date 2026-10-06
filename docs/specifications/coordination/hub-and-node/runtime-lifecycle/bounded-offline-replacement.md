# Bounded offline replacement

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; this does not make fleet health ready.

During registered replacement, the readiness window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready Hub-dependent component has that exact retryable code.

Replacement readiness judges regression, not perfection ([ADR-0475](../../../../decisions/operations/services/0475-judge-node-replacement-readiness-by-regression.md)). Before the service operation, apply reads the predecessor's snapshot as a baseline. A non-delivery component (`workspaceCoordination`, `remoteControl`, `conversation`, or `supervision`) may stay `unavailable` only with the exact status and failure code it already had. The receipt lists it in `carriedConditions`. `sync` and `workstreamReplication` never carry a failure over.

The window lasts sixty seconds past the latest startup progress: a first fresh snapshot or more accepted components. It is bounded at 600 seconds.

First onboarding has no baseline. It and every authentication, configuration, integrity, divergence, stale, mixed, unknown, or newly appearing failure still require complete readiness or fail closed. A timeout names each blocking component with its observed and baseline state.
