# ADR-0297: Separate claim reference eligibility from task evidence

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v14 is immutable terminal negative evidence. Eight Codex and eight Claude native-session runs achieved full recall, but Claude failed the reviewed precision gates because supporting documents that were not direct claim sources received E4 tokens.

Failed Claude release-preparation observations cited documents added only through `explicit_link` and adjacent search recommendations. Failed fuzzy-merge observations cited the two `explicit_link` additions beyond the direct sources. A diagnostic counterfactual removed only explicit-link-only documents from token eligibility while preserving their selection, loading, and injection. It was not a v14 rescore. Codex retained 87.5% mean precision, Claude reached 79.17%, both retained full recall, and no run failed precision. This isolates claim eligibility as the missing boundary.

Document classification cannot represent this distinction. Linked `task_evidence` can help interpret a direct source without being authoritative for the current claim; reclassifying it as governance would conflate behavior control with supporting task context.

## Decision

Require provider-neutral `referenceEligible: boolean` state for every context-envelope document and injected-document receipt, independently of `documentRole`:

- Direct task evidence selected by instructions, path rules, required task rules, handoffs, search recommendations, or graph recommendations is reference eligible.
- Task evidence selected only through the managed `explicit_link` relation remains selected, loaded, and injected but is not reference eligible.
- When a document has direct and explicit-link provenance, direct eligibility wins.
- Governance context is never reference eligible. A governance document with `referenceEligible: true` is schema-invalid.
- Only `task_evidence` with `referenceEligible: true` receives an E4 token or can produce `context.referenced` evidence.

Raw provider output remains unchanged at its existing content-addressed boundary. Eligibility is not an output rewrite and does not compare output with hidden evaluation identifiers.

`referenceEligible` is one required boolean per envelope and receipt document. It contains no document body, prompt, path beyond existing envelope state, provider secret, or expected evaluation identifier. Missing or invalid state fails contract validation. An envelope-receipt mismatch fails controlled injection before E3. A token fabricated for an ineligible document produces no E4 evidence.

The managed-run search summary derives `referencedDocuments` and sorted, deduplicated `referencedDocumentIds` only from canonical E4 evidence. These fields contain only a bounded count and document IDs, never bodies, paths, prompts, provider output, credentials, or expected evaluation identifiers. Missing derived fields fail consumers requiring E4 measurement without weakening the underlying event evidence.

The decision is provider neutral. Codex and Claude must serialize identical metadata, and common adapter tests must prove identical null-token behavior for supporting task context. V14 observations remain unchanged and must not be retried, repaired, replaced, or rescored.

## Consequences

Supporting linked context remains available to the model and observable as selected, loaded, and injected. Lervo can distinguish delivery from direct claim authority without asserting provider attention or semantic use.

Implementation and provider-free verification authorize neither live traffic nor activation. A fresh source-current paired checkpoint must preserve the existing gates: 100% recall per run, at least 50% precision per run, and at least 65% mean precision per provider. Activation remains default-off until that checkpoint passes.

## Verification

- Prove explicit-link-only task evidence has `referenceEligible: false`.
- Prove direct plus explicit-link selection remains `true`.
- Prove governance context with `true` is schema-invalid.
- Prove an envelope-receipt eligibility mismatch is rejected.
- Prove both adapters serialize supporting task context with a null token.
- Prove a fabricated ineligible token creates no E4 evidence.
- Run provider-free common-adapter tests and repository completion checks before a fresh paired canary.

## References

- [V14 activation rejection](0296-reject-activation-after-typed-context-managed-canary-v14.md)
- [V14 terminal evidence](../../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v14.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
- [Execution and evidence specification](../../../../../specifications/execution.md)
