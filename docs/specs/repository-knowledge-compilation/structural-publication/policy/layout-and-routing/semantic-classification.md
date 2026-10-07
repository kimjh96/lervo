# Semantic Classification

## Provider contract

The background resident classifies `semantic_classification_pending` documents during the lifecycle prefix of a convergence cycle. Only documents within the delegation's normalization roots qualify, in batches of at most eight.

The no-capability provider adapter receives `documentRouteClassificationInstruction`, route ids, paths, and descriptions, role ids and paths, and each document's path, workspace package, and first 8 KiB as untrusted data. The response schema permits exactly one outcome per document, with a short rationale:

- `route` with a configured `routeId`.
- `role` with a catalog `roleId`, for documents only.
- `retain_in_place`.
- `uncertain`.

Missing, duplicated, mismatched, or unknown-route entries are recorded as `uncertain`. Calls run under the convergence assignment, provider admission, and call budget, and record usage like other knowledge-worker calls.

## Evidence records

Host-private `.lervo/state/knowledge/document-route-classifications.json` stores evidence, not canonical state. It retains at most 4,096 records and prunes records that no current plan relies on or waits for. Losing a record only returns its document to `pending`.

A record-enabled move still passes the exact lifecycle plan, independent review, and apply. The materialization receipt records `classificationBases` with each destination digest, basis, and record digest.

## Legacy title terms

Pre-ADR-0476 layouts may contain `titleTerms` and `minimumTitleTermMatches`. Loading accepts them only for compatibility and converts them into the route's `description`; they never decide a route.

The next layout plan replaces the terms with that description through a Lervo-managed `describe_semantic_routes` update, or `upgrade_document_policy` for schema 1. The route-set digest remains unchanged.
