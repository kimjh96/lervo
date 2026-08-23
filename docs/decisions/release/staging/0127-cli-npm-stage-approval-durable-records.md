# ADR-0127: Durable npm Stage-Approval Records

- Status: accepted
- Decision date: 2026-08-21

## Context

Approval can publish, so its attempt must be durable before npm is called. Lost responses and reused authority must not conceal uncertain or duplicate publication.

## Decision

An immutable approval attempt first records the authorization digest, workflow target, registry, stage-ID digest, dist-tag, three tarball digests, reservation time, and prohibition on retry without reconciliation. A separate terminal record distinguishes exit zero, unknown post-call outcome, and pre-call abort. Exit zero still records `publicAvailability=not_claimed` and requires authenticated registry verification; an unknown outcome forbids blind retry.

A shared immutable-attempt filesystem adapter serves both staging and approval stores. It owns bounded, owner-only, exclusive durable files and enforces symlink and permission checks. Domain wrappers inject record validators, bindings, and error codes so their meanings remain distinct.

## Consequences

Tests cover every terminal meaning, modes, separation, duplicate/overwrite/binding attacks, and staging regressions. Actual approval and 2FA remain outside this decision.
