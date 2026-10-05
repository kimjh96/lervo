# Preservation Boundaries

`docs/archive/**`, `docs/inherited/**`, and exact repository role paths with `relocation: preserve` are canonical preservation boundaries. Scanning, structural compilation, capacity evaluation, and query retain their sources.

Generic layout migration must never:

- Relocate these sources.
- Interpret preserved collection frontmatter as current Lervo route metadata.
- Rewrite archive or inherited collection bytes through reference repair or provider normalization.
