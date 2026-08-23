# ADR-0127: Durable npm Stage-Approval Records

- Status: accepted
- Decision date: 2026-08-21

## Context

Approval can publish, so the attempt must be durable before npm is called. Lost responses and reused authority must not hide an uncertain or duplicate publication.

## Decision

An immutable approval attempt first records authorization digest, workflow target, registry, stage-ID digest, dist-tag, three tarball digests, reservation time, and retry prohibition without reconciliation. One separate terminal distinguishes exit zero, unknown post-call outcome, and pre-call abort. Exit zero still says publicAvailability=not_claimed and requires authenticated registry verification; unknown forbids blind retry.

A shared immutable attempt filesystem adapter serves both staging and approval stores. It owns owner-only exclusive durable files, bounds, symlink and permission checks, while domain wrappers inject record validators, bindings, and error codes so meanings stay distinct.

## Consequences

Tests cover all terminal meanings, modes, separation, duplicate/overwrite/binding attacks, and staging regressions. Actual approval and 2FA remain outside this decision.
