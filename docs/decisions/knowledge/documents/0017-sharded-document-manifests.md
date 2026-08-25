# ADR-0017: Sharded document manifests and no append-only documents

Status: `accepted`
Decision date: 2026-08-19

## Context

The original `.lervo/documents.yaml` stored every record in one growing, contended map. Appending topics or generation history to existing Markdown also harms navigation, review, and ownership boundaries. A thin central index only delays growth, while mandatory front matter contaminates user documents and providers may interpret it differently.

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

- `.lervo/documents/` is the registry index; do not create `index.yaml`.
- Name each manifest `<documentId>.yaml` and require its body ID to match. Each manifest is limited to 64 KiB, and v0 reads are limited to 4,096 entries.
- Reject symlinks, wrong extensions, subdirectories, and unknown entries as `document_layout_conflict`.
- Load manifests in filename-byte order into the existing in-memory `DocumentRegistry`.
- One target path has one owner. `parent`, `supersedes`, and `related` cannot self-reference or identify an unregistered document. Relation graphs are rebuildable derived indexes.
- Continue reading a lone legacy `.lervo/documents.yaml` under its old schema. `lervo init` never splits it automatically. If it coexists with the shard directory, fail without choosing either. Per-document APIs and compilers cannot mutate the legacy layout before explicit migration.
- ADR-0018 defines adoption and migration; ADR-0021 and ADR-0022 define parsing and patch candidates.

### Separate human source and machine metadata

- Documents use `text/markdown; charset=utf-8`. Store metadata in `.lervo/documents/<documentId>.yaml`, never in mandatory user front matter.
- Sidecars record profile, locale, audience, `sidecar` metadata placement, `separate_documents` history, `topic_documents` overflow, and `parent`/`supersedes`/`related` links.
- Never append a new decision or history to an old section. Create and relate a new ID and file.
- Keep entry documents short, containing only orientation and links. Preserve superseded manifests so provenance remains reconstructable.

### Size and update rules by ownership

- Never write user-owned documents. Recommend a topic split at 32 KiB and require separate review above 64 KiB; never auto-split.
- Replace only a managed block's declared region, limited to 8 KiB. Put overflow in a new document and leave a summary and link.
- Accept only these markers:

```text
<!-- lervo:begin block=<blockId> schema=1 -->
<!-- lervo:end block=<blockId> -->
```

- Block IDs and input source IDs must be unique within a manifest. ADR-0021 defines byte-exact, read-only CommonMark parsing; ADR-0022 defines a review-only patch candidate. Neither writes before a separate apply contract.
- Limit Lervo-generated documents to 64 KiB and 12 top-level sections. Replace a whole file only when its current hash equals the previous generated output; otherwise split and link.
- Store input and output hashes, generator, and policy version in `.lervo/generated/manifests/`, not body text. A later slice defines compiler schema and atomic publication.

### Failures and retention

| Code | Meaning |
| --- | --- |
| `contract_invalid` | Invalid schema, filename/ID, marker, relation, or path ownership. |
| `document_layout_conflict` | Legacy and sharded layouts coexist, or unsafe entries exist. |
| `not_initialized` | Neither layout exists. |

On failure, do not begin context execution or init application, migrate automatically, recover partially, or edit user Markdown. Errors and events exclude document bodies.

This decision stops registry and managed-Markdown growth. `.lervo/state/events.sqlite` remains an append-only evidence source in v0. Before long-lived operation, another ADR must define size/time segmentation, terminal-hash linkage, and atomic querying; document sharding must not hide that gap.

## Consequences

- Registering a document does not edit another manifest.
- Registry growth no longer expands one YAML file.
- User sources contain neither machine metadata nor generation history.
- Long generated content becomes linked topic documents instead of appended prose.
- Legacy registries remain readable but cannot silently mix with new compiler features.
