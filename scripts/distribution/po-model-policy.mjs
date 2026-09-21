const profileIds = ["routine", "reasoning", "review"];
const providerIds = ["codex", "claude"];

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function replaceExactModels(value, replacements, path = []) {
  if (typeof value === "string") {
    const key = path.at(-1);
    return key === "model" || key === "requestedModel" || path.at(-2) === "models"
      ? (replacements[value] ?? value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceExactModels(item, replacements, path));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceExactModels(item, replacements, [...path, key]),
    ]),
  );
}

/** Reconciles deployment-selected models without changing identities, authority, or credentials. */
export function reconcilePoModelPolicy(configuration, policy) {
  const source = record(configuration, "Node configuration");
  const selected = record(policy, "PO model policy");
  if (selected.schemaVersion !== 1) throw new Error("The PO model policy version is unsupported.");
  const replacements = record(selected.modelReplacements, "Model replacements");
  const profiles = record(selected.executionProfiles, "Execution profiles");
  for (const [from, to] of Object.entries(replacements)) {
    if (typeof to !== "string" || from.length === 0 || to.length === 0 || from === to) {
      throw new Error("A model replacement is invalid.");
    }
  }

  const result = replaceExactModels(source, replacements);
  const host = record(result.remoteCommands?.providerHost, "Node provider host");
  const installed = record(host.executionProfiles, "Installed execution profiles");
  for (const profileId of profileIds) {
    const target = record(installed[profileId], `Installed ${profileId} profile`);
    const route = record(profiles[profileId], `Policy ${profileId} profile`);
    if (!providerIds.includes(route.preferredProvider)) {
      throw new Error(`The ${profileId} preferred provider is invalid.`);
    }
    target.preferredProvider = route.preferredProvider;
    const targetProviders = record(target.providers, `Installed ${profileId} providers`);
    const routeProviders = record(route.providers, `Policy ${profileId} providers`);
    for (const providerId of providerIds) {
      const targetProvider = record(
        targetProviders[providerId],
        `Installed ${profileId}.${providerId} route`,
      );
      const routeProvider = record(
        routeProviders[providerId],
        `Policy ${profileId}.${providerId} route`,
      );
      if (
        typeof routeProvider.model !== "string" ||
        routeProvider.model.length === 0 ||
        !["medium", "high"].includes(routeProvider.reasoningEffort) ||
        (profileId === "routine") !== (routeProvider.reasoningEffort === "medium")
      ) {
        throw new Error(`The ${profileId}.${providerId} model route is invalid.`);
      }
      targetProvider.model = routeProvider.model;
      targetProvider.reasoningEffort = routeProvider.reasoningEffort;
    }
  }
  return result;
}
