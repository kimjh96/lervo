# Replica receipt input to operating attention

This document describes the source-observed CLI inspection and projection boundary in `apps/cli/src/operating-attention-inspection.ts`, `operating-attention-projection.ts`, and `repository-replica-divergence-source.ts`. It supplements [Operating attention](../operating-attention.md) and [Divergence and merge](../../coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md).

## Receipt reading and failure meaning

The reader loads `.lervo/state/repository-replica.json` as UTF-8 and passes parsed JSON to `readRepositoryReplicaOpenDivergence` from `@lervo/sync`. Validation inside that imported decoder is outside these source files.

A missing file (`ENOENT`) returns `status: observed` with null divergence. This means there is no receipt-backed open divergence to project; it does not prove replica parity or whether replication is configured.

Other filesystem read failures, empty text, text whose JavaScript string length exceeds 65,536, JSON parse failures, and decoder exceptions return `status: invalid` with the lifecycle issue code `repository_replica_receipt_invalid`. Its prescribed instruction is:

```text
inspect .lervo/state/repository-replica.json; the next replica coordinator cycle rewrites it
```

Although the source constant is named `MAXIMUM_RECEIPT_BYTES`, the check uses decoded string length after the entire file is read. It is neither a pre-read allocation bound nor an exact UTF-8 byte limit. The invalid result contains the bounded issue code and instruction, without copying receipt contents or filesystem error text.

## Explicit inspection composition

After opening project storage, the explicit inspector concurrently retrieves the verified current workstream, canonicalization candidates, terminal lifecycle inspection, and replica divergence. Candidate-list and lifecycle-inspection failures become their respective unavailable coverage results.

An invalid replica receipt is appended to lifecycle issues only when lifecycle coverage is available. If lifecycle inspection is already unavailable, that coverage remains unavailable and the replica issue is not separately included. An observed open divergence is passed independently to the projection, including when lifecycle coverage is unavailable.

The inspector does not add a replica coverage field. It does not convert project-storage or verified-workstream failures into empty successful reports. Once storage has opened, its close operation is awaited in `finally`.

## Divergence item

An open divergence produces one `repository_replica_divergence` item before global deduplication and truncation. The item exposes `replicaId`, `divergenceId`, `reason`, `conflictPathCount`, `conflictPaths`, and `openedAt`, with schema version 1 and state `action_required`. Its item ID combines `repository_replica_divergence_` with the first 24 characters after the divergence hash's `sha256:` prefix.

The item has `actionOwner: user`, `requiresUserAction: true`, and `blocking: false`. User action does not itself make this report item a work blocker or authorize any repository mutation.

For `no_common_history`, the instruction asks the user to choose which host's repository to retain and re-seed the other. Otherwise, it directs the user to make the conflicting paths agree or run the coordinator-host command:

```text
lervo-node repository-replica reconcile --config <coordinator-config> --replica <replica-id> --prefer local|peer
```

The report copies conflicting paths from the decoded receipt. This local report behavior is distinct from canonical replica events, whose privacy contract uses path digests.

## Aggregate semantics

Replica items join workstream, canonicalization, and lifecycle items in the existing item-ID deduplication and ordering. Ordering prioritizes user action, then blocking state, then kind and item ID. At most 256 items are returned; summary counts include all deduplicated items before truncation.

The digest binds project identity, workstream coordinates, existing coverage fields, and returned items. It excludes observation time and does not include summary counts or omitted item bodies. A returned divergence therefore participates in the digest; the digest must not be treated as an exhaustive fingerprint of omitted items.

An invalid receipt represented as a lifecycle issue is agent-owned, requires no user action, and is nonblocking under the current lifecycle classification. It still makes aggregate status `action_required`. Unavailable lifecycle coverage also prevents an empty-success status when the invalid-receipt issue cannot be included.

These sources establish explicit CLI inspection and pure projection behavior. They do not establish direct-terminal receipt wiring, installed fleet acceptance, event publication, or successful test execution. Existing attention authority and acknowledgment limitations continue to apply.
