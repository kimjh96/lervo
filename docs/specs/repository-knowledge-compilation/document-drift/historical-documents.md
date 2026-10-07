# Historical Documents

A document is historical if it meets any of these conditions:

- It is under `docs/archive/` or an `archive` capacity override.
- It has historical front matter.
- It has a leading `Historical`, `Archived`, or `Superseded` blockquote banner.

Structural publication lists historical documents in a separate "Historical documents (not current design)" group and labels each entry.

Default knowledge retrieval excludes historical documents. A query naming history (`archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, `deprecated`) includes them. Each historical hit has `historical: true`.

Drift checks skip historical documents.
