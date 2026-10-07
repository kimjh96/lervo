# Layout Role Templates

Lervo's product-document role templates (`product_vision`, `system_architecture`, `execution_specification`, `delivery_roadmap`) are seeded only where their path or an alias exists.

The layout migration prunes unmodified templates with no file. It re-adds a template only when moving a document there through explicit `lervo.document.role` metadata, a declared legacy alias, or a recorded semantic `role` classification ([ADR-0476](../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)). Both changes form one Lervo-managed update to `.lervo/knowledge/document-layout.yaml`.
