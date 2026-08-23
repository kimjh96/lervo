# ADR-0017: Sharded document manifests and no append-only documents

Status: `accepted`
Decision date: 2026-08-19

## Context

The original `.lervo/documents.yaml` stored every record in one map, making one file grow and become a contention point. Appending every new topic or generation history to existing Markdown similarly harms navigation, review, and user-owned boundaries. A thin central index merely delays the problem, while mandatory front matter contaminates user documents and may be interpreted differently by providers.

## Decision

### The directory is the index

New projects use:

```text
.lervo/
  documents/
    doc_architecture_01.yaml
    doc_skill_guide_01.yaml
  generated/
    documents/
      project-context.md
    manifests/
      doc_project_context.json
```

- `.lervo/documents/` itself is the registry index; create no `index.yaml`.
- Name each file `<documentId>.yaml` and require the body ID to match. Limit a manifest to 64 KiB and a v0 read to 4,096 entries.
- Reject symlinks, wrong extensions, subdirectories, and unknown entries as `document_layout_conflict` rather than ignoring them.
- Load manifests in filename-byte order into the existing in-memory `DocumentRegistry`.
- One target path has one owner. `parent`, `supersedes`, and `related` cannot self-reference or name an unregistered document. Any relation graph is a rebuildable derived index.
- Continue reading a lone legacy `.lervo/documents.yaml` with its old schema. `lervo init` never auto-splits it. If legacy file and shard directory coexist, fail without choosing either. Per-document APIs and compilers do not mutate legacy layout before explicit migration.
- ADR-0018 defines explicit adoption and migration; ADR-0021/0022 define parsing and patch candidates.

### Separate human source and machine metadata

- Documents are `text/markdown; charset=utf-8`; put metadata in `.lervo/documents/<documentId>.yaml`, never mandatory user front matter.
- Sidecars record profile, locale, audience, `sidecar` metadata placement, `separate_documents` history, `topic_documents` overflow, and parent/supersedes/related links.
- Do not append a new decision or history to an old section. Create a new ID/file and link it through supersedes or related relations.
- Keep entry documents short: orientation and links only. Preserve prior manifests when superseded so provenance remains reconstructable.

### Size and update rules by ownership

- Never write user-owned documents. Recommend topic split at 32 KiB and require separate review above 64 KiB; never auto-split.
- A managed block may replace only its declared region and is limited to 8 KiB. Split overflow into a new document and leave a summary/link.
- Accept only these markers:

```text
<!-- lervo:begin block=<blockId> schema=1 -->
<!-- lervo:end block=<blockId> -->
```

- Block IDs and input source IDs must be unique within one manifest. ADR-0021 defines byte-exact, read-only CommonMark parsing; ADR-0022 defines a review-only patch candidate. Neither writes before a separate apply contract.
- Lervo-owned generated documents are limited to 64 KiB and 12 top-level sections. Replace a whole file only when current hash equals the previous generated output; otherwise split and link.
- Store input/output hashes, generator, and policy version in `.lervo/generated/manifests/`, not body text. A later slice defines compiler schema and atomic publication.

### Failures and retention

| Code | Meaning |
| --- | --- |
| `contract_invalid` | Invalid schema, filename/ID, marker, relation, or path ownership. |
| `document_layout_conflict` | Legacy/sharded layouts coexist or unsafe entries exist. |
| `not_initialized` | Neither layout exists. |

On failure, do not start context execution or init application, auto-migrate, partially recover, or edit user Markdown. Errors and events exclude document bodies.

This decision stops growth in registries and managed Markdown. `.lervo/state/events.sqlite` remains an append-only evidence source in v0. Before long-lived operation, a separate ADR must define size/time segmentation, terminal-hash linkage, and atomic querying; do not hide that gap behind document sharding.

## Consequences

- Registering one document does not edit another document's manifest.
- Registry growth no longer produces one ever-growing YAML file.
- User source remains free of machine metadata and generation history.
- Long generated content becomes linked topic documents, not appended prose.
- Legacy registries remain readable but cannot silently mix with new compiler features.
