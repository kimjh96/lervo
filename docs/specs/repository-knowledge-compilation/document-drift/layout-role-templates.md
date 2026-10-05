# Layout Role Templates

Lervo's product-document role templates (`product_vision`, `system_architecture`, `execution_specification`, `delivery_roadmap`) are seeded only where their path or an alias exists.

The layout migration prunes an unmodified template that has no file. It re-adds a template only when it moves a recognized document there. Both changes form one Lervo-managed update to `.lervo/knowledge/document-layout.yaml`.
