# V13 request-scope redundancy diagnosis

Status: `complete`
Date: 2026-08-29

## Finding

V13 used identical paired requests and candidate envelopes and completed every provider turn without carrier, adapter, replay, privacy, or primary-effect failure. Both providers retained 100% reviewed-source recall. The failure was therefore selection-stage precision: Claude selected three release documents beyond the two reviewed canonical sources and reached 40% precision.

The release request asks which canonical sources to follow before beginning CLI release preparation. `AGENTS.md` routes that scope to the CLI version-management guide and ADR-0221. The guide owns contributor procedure, the completion command, generated-owner commands, and tag handoff. ADR-0221 owns reviewed release intent, preparation authority, rollback, and authority separation.

The three additional selections add no distinct claim required in that task phase:

- ADR-0223 enforces base-bound repository completion. Although referenced by the version guide, it is a completion-enforcement adjunct, not another release-preparation entrypoint.
- The automated version-management roadmap records completed delivery scope and acceptance evidence. It is retrospective planning evidence, not current execution authority or contributor procedure.
- The commit convention applies before creating a commit and explains breaking-change syntax. The request concerns release-preparation sources, not authoring a later commit.

These roles derive from the request, `AGENTS.md`, and canonical source bodies. Provider output is used only to locate the observed selection pattern; raw provider output is neither retained nor interpreted as reasoning.

## Corroborating fuzzy-merge pattern

Claude also made three unexpected selections across the first two v13 fuzzy-merge repetitions. ADR-0180 and ADR-0227 remain required: ADR-0180 supplies hash-bound human conflict-resolution authority, while ADR-0227 requires review for fuzzy pairs and prohibits automatic promotion.

ADR-0187 describes the adjacent exact-merge path, and the repository knowledge compilation specification describes the broader lifecycle. They provide background and cross-references but do not answer whether fuzzy merge may proceed without approval. As with the release case, supplied bodies expanded the apparent claim inventory beyond the phase named by the request.

## Protocol diagnosis

The v11 claim-coverage protocol starts by identifying items “supported by the supplied bodies.” This repaired omissions but lets source content introduce downstream, adjacent, or general-procedure claims not required by the request. Minimization then preserves a direct source for every expanded item, converting body coverage into over-selection.

A bounded, provider-neutral successor may change only the selection protocol:

1. Derive the current task and phase from the request before reading supplied-body claims.
2. Inventory only the claims, authority boundaries, prerequisites, and operational instructions necessary for that phase.
3. Do not let a cross-reference, downstream stage, roadmap item, or generic procedure create a required item by itself.
4. Retain a referenced source when its own body directly supplies a distinct prerequisite or authority necessary for the current phase.
5. Apply the existing coverage-preserving minimization only after creating that scoped inventory.

This retains ADR-0180 for fuzzy-merge approval authority while excluding exact-merge background. It retains the CLI guide and ADR-0221 while excluding completion, roadmap, and commit-stage expansion.

## Limits

This diagnosis does not establish provider reasoning, understanding, answer quality, or production suitability. It does not reclassify or retry v13, expose expected paths, change candidate generation or ground truth, relax thresholds, or authorize activation. A fresh paired micro-pilot is required before designing broader confirmation.

## References

- [V13 evidence](provider-shadow/linked-evidence-provider-shadow-pilot-v13.md)
- [ADR-0268](../../decisions/search/activation/0268-diagnose-and-confirm-claim-coverage-v13.md)
- [Repository instructions](../../../AGENTS.md)
- [CLI version management](../../distribution/cli-version-management.md)
- [ADR-0221](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md)
- [ADR-0180](../../decisions/knowledge/semantics/0180-hash-bound-human-conflict-resolution.md)
- [ADR-0227](../../decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md)
