# Layout and Routing

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Each route has an `id`, `path`, `priority`, and prose `description` of its scope. [ADR-0476](../../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) defines routing. Lervo never uses keyword or title-term matches against document names or headings to make decisions.

- [Candidates and routing](layout-and-routing/routing.md): retention evidence, destination precedence, deferrals, and blockers.
- [Semantic classification](layout-and-routing/semantic-classification.md): provider contract, evidence records, and legacy layout compatibility.
- [Contract diagnostics](layout-and-routing/contract-diagnostics.md): validation issues, planning failures, and JSON errors.
