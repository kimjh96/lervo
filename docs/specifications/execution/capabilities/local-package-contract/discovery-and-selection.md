# Discovery and selection

An optional `discovery` block binds a display name, summary, bounded keywords and natural-language intents, and an explicit `autoSelect` decision. Managed runs score only this verified metadata:

- Exact intent phrases and token matches have deterministic weights.
- Candidates below the threshold are ignored; ties are stably ordered.
- At most eight packages are selected.

When the caller supplies an explicit package coordinate, recommendation remains observable, but the coordinate determines selection and bypasses semantic capability grounding. Role defaults also take precedence over automatic selection. Recommendation never proves selection, loading, or use.
