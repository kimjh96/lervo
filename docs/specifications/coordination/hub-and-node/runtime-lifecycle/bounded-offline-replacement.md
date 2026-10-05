# Bounded offline replacement

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; this does not make fleet health ready.

During registered replacement, a bounded sixty-second window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready required component has that exact retryable code.

First onboarding and every authentication, configuration, integrity, divergence, stale, mixed, or unknown failure still require complete readiness or fail closed.
