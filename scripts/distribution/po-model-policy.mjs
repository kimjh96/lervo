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
  if (selected.schemaVersion !== 2) throw new Error("The PO model policy version is unsupported.");
  const replacements = record(selected.modelReplacements, "Model replacements");
  const profiles = record(selected.executionProfiles, "Execution profiles");
  const conversationRoutes = record(selected.conversationRoutes, "Conversation routes");
  const routineProviders = record(
    record(profiles.routine, "Policy routine profile").providers,
    "Policy routine providers",
  );
  const modelByProvider = Object.fromEntries(
    providerIds.map((providerId) => [
      providerId,
      record(routineProviders[providerId], `Policy routine.${providerId} route`).model,
    ]),
  );
  for (const [from, to] of Object.entries(replacements)) {
    if (typeof to !== "string" || from.length === 0 || to.length === 0 || from === to) {
      throw new Error("A model replacement is invalid.");
    }
  }

  const result = replaceExactModels(source, replacements);
  const host = record(result.remoteCommands?.providerHost, "Node provider host");
  const models = record(host.models, "Node provider models");
  for (const providerId of providerIds) models[providerId] = modelByProvider[providerId];
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
  for (const [participantId, route] of Object.entries(conversationRoutes)) {
    const selection = record(route, `Conversation route ${participantId}`);
    if (
      !/^ptc_[a-z0-9_]+$/.test(participantId) ||
      !providerIds.includes(selection.provider) ||
      selection.model !== modelByProvider[selection.provider]
    ) {
      throw new Error(`The ${participantId} conversation route is invalid.`);
    }
  }
  const conversations = [
    ...(result.discordConversation === undefined ? [] : [result.discordConversation]),
    ...(result.discordConversations ?? []),
  ];
  const seen = new Set();
  for (const conversation of conversations) {
    const participantId = conversation.agentParticipantId;
    if (!(participantId in conversationRoutes)) continue;
    if (seen.has(participantId)) throw new Error(`Duplicate conversation route: ${participantId}`);
    seen.add(participantId);
    const route = conversationRoutes[participantId];
    const routing = record(conversation.routing, `${participantId} routing`);
    const response = record(routing.response, `${participantId} response`);
    response.provider = route.provider;
    response.model = route.model;
    response.reasoningEffort = "medium";
    const reviewer = route.provider === "codex" ? "claude" : "codex";
    routing.resultEvaluation = {
      ...record(routing.resultEvaluation ?? {}, `${participantId} result evaluation`),
      provider: reviewer,
      model: modelByProvider[reviewer],
      reasoningEffort: "high",
    };
  }
  if (result.outcomeSupervision?.ownerReasoning?.provider === "codex") {
    result.outcomeSupervision.ownerReasoning.model = modelByProvider.codex;
  }
  return result;
}
