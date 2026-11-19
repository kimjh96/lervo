<!-- lervo-release package="@lervo/cli" version="0.29.2" schema="1" -->

## What's changed

- Reject a background document normalization that breaks a Markdown link it did not break before, instead of committing the broken link as a lint warning.
- Reuse each unchanged source file's extracted units across repository scans in one process, so the knowledge host stops re-parsing every JavaScript and TypeScript file on each scan.
- Unblock knowledge publication: default roots widen to the active delegation, skills are never normalized, the repair counts its own commits as Lervo's, and the Node resident applies stored owner rules with recorded failures.
