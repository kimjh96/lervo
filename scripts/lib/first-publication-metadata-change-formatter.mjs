const changeMessages = {
  repository: (value) => `Set the GitHub repository to ${value.url}.`,
  license: (value) => `Set the license to ${value}.`,
  "publishConfig.registry": (value) => `Pin the npm publication registry to ${value}.`,
  "publishConfig.provenance": () => "Explicitly enable npm provenance.",
};

const currentStateMessages = {
  missing: "The current value is missing.",
  different: "The current value differs from the selection.",
};

export function formatFirstPublicationMetadataChange(change, { currentState = false } = {}) {
  const message = changeMessages[change.field]?.(change.value) ?? `Set the ${change.field} value.`;
  if (!currentState) return message;
  const state = currentStateMessages[change.currentState] ?? "Change the current value.";
  return `${message} ${state}`;
}
