import type { ProviderSummary } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode, type SessionHost } from "../../../ports";
import { useWorkspaceStore } from "../../workspaces";
import { type ProviderRegistry, useProviderStore } from "./store";

/**
 * Loads the provider list when the core advertised it in its workspace list, keeping only the
 * providers that offer the native conversation, the only one the ADE shows (ADR-0617). An older
 * core never receives the command, because it would end the core link. A failure keeps a list
 * that loaded before.
 */
export async function loadProviders(
  commands: ApplicationCommands,
  advertised: readonly string[],
): Promise<void> {
  if (!advertised.includes("provider.list")) {
    useProviderStore.setState({ registry: { status: "older" } });
    return;
  }
  try {
    const { providers, defaultProvider } = await commands.run("provider.list");
    const offered = providers.filter((provider) => provider.conversationModes.includes("native"));
    useProviderStore.setState({
      registry: { status: "loaded", providers: offered, defaultProvider },
    });
  } catch (failure) {
    if (useProviderStore.getState().registry.status !== "loaded")
      useProviderStore.setState({ registry: { status: "failed", code: failureCode(failure) } });
  }
}

/**
 * Keeps the provider registry current: once per connection, after the first workspace list that
 * says which commands the core answers. Returns the unsubscribe function.
 */
export function bindProviders(input: {
  client: Pick<SessionHost, "onState">;
  commands: ApplicationCommands;
}): () => void {
  let stale = true;
  const load = (advertised: readonly string[] | null) => {
    if (!stale || advertised === null) return;
    stale = false;
    void loadProviders(input.commands, advertised);
  };
  const unsubscribeState = input.client.onState((state) => {
    if (state === "connected") stale = true;
  });
  const unsubscribeLists = useWorkspaceStore.subscribe((store, previous) => {
    if (store.advertisedCommands !== previous.advertisedCommands) load(store.advertisedCommands);
  });
  load(useWorkspaceStore.getState().advertisedCommands);
  return () => {
    unsubscribeState();
    unsubscribeLists();
  };
}

/**
 * The provider a start uses: the one the user chose last when it is installed, then the core's
 * default, then the first installed one. Null when the registry has not loaded or nothing is
 * installed, and the core then decides.
 */
export function chooseProvider(registry: ProviderRegistry, wanted: string): ProviderSummary | null {
  if (registry.status !== "loaded") return null;
  const installed = registry.providers.filter((provider) => provider.installed);
  return (
    installed.find((provider) => provider.provider === wanted) ??
    installed.find((provider) => provider.provider === registry.defaultProvider) ??
    installed[0] ??
    null
  );
}
