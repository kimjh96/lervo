# Contract Diagnostics

Layout validation reports every violation as a structured issue containing:

- `pointer`: an RFC 6901 JSON pointer into the parsed file, such as `/documentPolicy/rewrite` or `/routes`.
- `rule`: `required`, `type`, `const`, `pattern`, `range`, `enum`, `min_items`, `max_items`, `unique`, `repository_path`, `document_path`, `route_description`, or `title_term` (legacy terms only).
- Optional `roleId` for document-policy roles.
- `message`.

The thrown `contract_invalid` error carries the full issue list; its message names at most 16 issues. Issues contain only layout coordinates and rule names, never document content.

Structural migration and refresh plans load the layout as apply-time lint does. Invalid, unparsable, and unreadable layouts add `document_layout_contract_invalid`, `document_layout_invalid_yaml`, and `document_layout_unreadable` blockers, respectively, with the same issues. The plan is `blocked` rather than reporting ready and failing during apply.

With `--json`, command failure emits one `{ schemaVersion: 1, status: "failed", error: { code, message, issues?, ... } }` envelope on stdout and no unstructured stderr text. Applying a blocked plan fails as `knowledge_plan_blocked` with its blockers and conflicts.
