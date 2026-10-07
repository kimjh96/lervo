# Document ownership

Each document has one write model:

- `user`: register and read bytes; never rewrite automatically.
- `managed_blocks`: replace only an exact marked block after content-bound approval.
- `lervo_generated`: refresh only when prior generation proves ownership.

## Repository entrypoints

README is a byte-preserved, normalization-independent public entrypoint by default. An optional improvement is a separate audience-and-intent-bound proposal with individual protected-coordinate dispositions.

AGENTS is the provider-neutral agent entrypoint with a fixed-size managed bootstrap. Repository knowledge resolves canonical instruction and skill routing by task purpose and target paths, so adding a source does not edit AGENTS.

CLAUDE imports AGENTS through a managed bridge while retaining its user region. Provider settings remain provider-specific; migration adds only approved Lervo hooks and preserves all other semantics.
