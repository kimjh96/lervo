# Tool-neutral rewrite ownership

The document ownership registry is authoritative for `lervo_generated`, `managed_blocks`, and reviewed-exact normalization outputs. Knowledge lifecycle operations do not write tracked `.prettierignore` bytes. Existing managed blocks are obsolete adapter projections, not ownership truth; they may be removed after an ownership-aware wrapper becomes active.

The repository formatter entrypoint derives protected paths directly from the neutral registry before invoking its formatter. Tracked user ignore files remain stable.

The common adapter descriptor declares only a capability (`format`, `autofix`, `transform`, or `generate`), managed rules, and content-bound dry-run evidence; canonical ownership policy contains no tool identifier.

A rewriter without a registry-bound adapter must prove identical before-and-after hashes for every protected path or fail closed. A rewriter without neutral ownership evidence is unmanaged and cannot mutate protected bytes through Lervo.
