# Public README migration

Status: `complete`
As of: 2026-08-24
Completed: 2026-08-25

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the separate improvement proposal (`lervo readme propose`) in items 4, 6, and 8 and the accepted-rewrite acceptance line. Byte preservation, the protected-coordinate inventory, and its freshness checks stay.

## Problem

The root README is the public product, package, and contributor entrypoint for many open-source repositories. Structural migration preserves it and requires exact approval for user-byte changes. Reviewed normalization instead treated every README as one bounded `human_readme`, could rewrite the entire root file, required a visible route to `AGENTS.md` when present, and did not deterministically preserve HTML presentation, badges, images, or ordinary Markdown link targets. Exact approval prevents silent damage but does not make rewriting public READMEs an appropriate default.

## Product outcome

Lervo recognizes the public root README as a distinct publication surface. Installation must not expose internal agent operations, weaken public onboarding, or alter branding and package coordinates. A reviewed improvement may be proposed separately, but repository readiness never depends on accepting a rewrite.

## Required contract

1. Existing root README bytes remain user-owned, stay at the root, and default to `preserve`. Declining a rewrite does not leave knowledge or terminal readiness stale.
2. Agent routing belongs in `AGENTS.md` and provider bridges. A public README need not mention Lervo, AGENTS, provider hooks, or internal bookkeeping.
3. The scanner and knowledge compiler may cite the preserved README as current source evidence without rewriting it.
4. A public README improvement is a separate content-bound proposal with human-readable before-and-after review and an explicit audience and intent contract.
5. Protected public coordinates include HTML blocks, images, badge labels and targets, Markdown link targets, anchors, fenced commands, package names, installation commands, version requirements, license and security links, sponsor links, tables, and accessibility text. Removing or changing any coordinate requires an individually visible disposition.
6. The proposal validates first-screen comprehension, product positioning, installation accuracy, documentation links, API and package identity, contributor guidance, license, accessibility, and rendering portability. It does not inject generated repository navigation.
7. The root README never splits automatically. Durable internal detail routes to semantically grouped documentation; public guides may move only through a separately approved, link-safe plan.
8. A missing README may receive a minimal generated candidate, but public claims, badges, package coordinates, and community policies are never invented. The owner may keep the repository without a README until enough verified inputs exist.
9. Lifecycle records bind source and output hashes, profile and language versions, protected-coordinate coverage, reviewer approval, and verification. Later edits make only the reviewed proposal stale, not the repository unusable.

## Flemo acceptance fixture

Use `/Users/jonghyeok/orca/flemo/README.md` as a local acceptance fixture without modifying its user-owned worktree. Migration must preserve its centered HTML logo and heading, npm and license badges, product statement, package names, installation command, documentation and playground URLs, and license attribution. Zero-approval installation must leave every README byte unchanged and still reach Lervo terminal readiness.

## Acceptance

- Structural migration and full onboarding leave an existing public README byte-identical by default.
- Knowledge queries and managed context can use exact README source units without normalization.
- No generated or normalized README requires an AGENTS or Lervo reference.
- Public-coordinate removal, target changes, invented claims, or package-command changes fail before review.
- An explicitly accepted rewrite remains one root entrypoint, passes rendering and link verification, and records exact lifecycle evidence.

## Completion evidence

ADR-0206 excludes the root README from required normalization, removes AGENTS routing from public readiness, and adds a separate audience-and-intent-bound proposal with deterministic protected-coordinate inventory and individual change approvals. Tests cover byte preservation, rejection of internal bookkeeping, prevention of claims in missing READMEs, deterministic coordinate extraction, exact approval, durable apply, internal root symlinks, and HTML or Markdown primary headings.

Installed acceptance used Flemo's root symlink and centered HTML heading. The proposal was current with 17 protected coordinates, zero operations, identical SHA-256 before and after, and the symlink preserved; the Flemo worktree was not modified.

## Dependencies

- [Existing document adoption](../../decisions/knowledge/documents/0018-existing-document-adoption.md)
- [Language-aware bounded publication](../../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Reviewed document normalization](../../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Repository knowledge compilation](../../specs/repository-knowledge-compilation.md)
