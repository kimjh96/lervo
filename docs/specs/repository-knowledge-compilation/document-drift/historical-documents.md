# Historical Documents

A document is historical if it is under `docs/archive/` or an `archive` capacity override, has historical front matter, has a leading `Historical`, `Archived`, or `Superseded` blockquote banner, or has a header `Status:` line whose first token is `superseded`, `historical`, or `archived` ([ADR-0562](../../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md)). The header is every line before the first `##` heading, and the line may be a list item, such as `- Status: superseded by [ADR-0394](...)`. A `partially_superseded` status stays current.

Structural publication lists historical documents in a separate "Historical documents (not current design)" group and labels each entry.

Default knowledge retrieval excludes historical documents. A query naming history (`archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, `deprecated`) includes them, and each historical hit has `historical: true`.

Drift checks skip historical documents.
