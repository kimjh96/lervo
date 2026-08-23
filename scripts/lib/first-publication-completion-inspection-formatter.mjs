export function formatFirstPublicationCompletionInspection() {
  return [
    "Verified the first-publication transition record.",
    "- Stage evidence source: matches the current manifest",
    "- Completion basis: linked to npm stage approval result reconciliation",
    "- Remaining manual actions: none",
    "- Current npm and GitHub external state: not queried again during this inspection",
    "",
  ].join("\n");
}
