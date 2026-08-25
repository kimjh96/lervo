# ADR-0203: Read-only repository Node onboarding reconciliation

Status: `accepted`
Date: 2026-08-25

## Context

The repository Node fleet registry establishes collision-free desired identity, but onboarding needs a bounded answer before any local-state write, service mutation, or external registration. A registry entry or service file is not proof that the runtime is active, ready, authorized, or synchronizing.

## Decision

`lervo repository node plan` creates a read-only `repository_node_onboarding` plan from an absolute repository root, node ID, destination ID, runtime version, service manager, optional fleet-registry path, and optional service home. It reloads the project manifest, requires Hub synchronization policy, canonicalizes the physical root, derives the repository identity hash and deterministic instance identity, validates the complete fleet registry, and compares desired coordinates with the project entry.

The plan contains:

- `planId`, `outcome`, and `verification: manifest_revalidated`;
- desired secret-free repository, Node, destination, runtime, manager, service, and health coordinates;
- registry path, `register | refresh | unchanged`, and the matching current entry when present;
- expected per-instance and legacy singleton service paths with `absent | present_unverified | conflict` observations and content hashes for safe present files;
- activation and readiness fixed to `not_observed`;
- bounded actions with `required | not_required | unobserved`, one authority category, and failure meaning;
- explicit local-output privacy and staleness declarations.

Action authorities are `local_state_write`, `service_installation`, `service_transition`, `external_registration`, and `runtime_observation`. The planner neither grants them nor performs their effects. Service-file presence is only `present_unverified`: the planner does not parse definition bodies, query the service manager, issue credentials, contact the Hub, install or activate services, or collect the three readiness observations.

A present legacy `lervo-node.service` or `com.lervo.node.plist` produces `review_legacy_singleton` and is never stopped, overwritten, or removed. An unsafe expected service target produces `review_service_conflict` and must not be overwritten.

## Privacy and lifecycle

The plan is returned only to the local caller. Absolute paths are local output; credentials and service-definition bodies are excluded. Planning creates no durable state or event because it performs no external or runtime effect. It does not claim installation, activation, authorization, readiness, synchronization, or repair.

The plan becomes stale when the project manifest, fleet registry, desired coordinates, expected service target, or legacy service target changes. A later mutating reconciler must recreate it and bind approval to current bytes and observations before each effect.

## Failure meaning

Invalid or unsafe roots, manifests, Hub policy, registry permissions or shape, desired coordinates, service home, duplicate identity, and conflicting project/root/node bindings fail closed with `node_fleet_*` codes. Failure changes no registry, service, credential, or repository byte. `reconcile_required` means at least one local desired-state or service/legacy review remains. `observation_required` means observed registry and service-file coordinates need no immediate reconciliation, while credentials, activation, and readiness remain unobserved.

## Consequences

First onboarding, unchanged desired state, stale registry coordinates, legacy singleton presence, and two repositories on one device share one deterministic planning contract. Exact plan application, transactional upgrade, activation, readiness, and fleet status are defined by [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md). Legacy transition and external credential issuance remain separately authorized.

This extends [ADR-0202](0202-repository-node-fleet-identity-and-registry.md) without changing its registry-write or service-management authority boundaries.
