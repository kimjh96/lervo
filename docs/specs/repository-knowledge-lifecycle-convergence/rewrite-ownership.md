# Tool-neutral rewrite ownership

The document ownership registry is authoritative for `lervo_generated`, `managed_blocks`, and reviewed-exact normalization outputs. Knowledge lifecycle operations must not write tracked `.prettierignore` bytes. Existing managed blocks are obsolete adapter projections, not ownership truth; they may be removed after an ownership-aware wrapper becomes active.

Before invoking its formatter, the repository formatter entrypoint derives protected paths directly from the neutral registry. Tracked user ignore files remain stable.

The common adapter descriptor declares only a capability (`format`, `autofix`, `transform`, or `generate`), managed rules, and content-bound dry-run evidence. Canonical ownership policy contains no tool identifier.

A rewriter without a registry-bound adapter must prove identical before-and-after hashes for every protected path or fail closed. A rewriter without neutral ownership evidence is unmanaged and cannot mutate protected bytes through Lervo.
