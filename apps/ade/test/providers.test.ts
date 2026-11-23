import type { ProviderSummary } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  bindProviders,
  chooseProvider,
  loadProviders,
  useProviderStore,
} from "../src/features/providers";
import { useWorkspaceStore } from "../src/features/workspaces";
import { type ApplicationCommands, type ConnectionState, RequestFailure } from "../src/ports";

const capabilities = {
  nativeConversation: true,
  sessionIdBinding: true,
  hooks: false,
  mcp: false,
  systemPromptFile: false,
  resume: true,
};

function provider(
  id: string,
  displayName: string,
  installed: boolean,
  native = true,
): ProviderSummary {
  return {
    provider: id,
    displayName,
    capabilities: { ...capabilities, nativeConversation: native },
    conversationModes: native ? ["native", "cli"] : ["cli"],
    preferredMode: native ? "native" : "cli",
    installed,
  };
}

/**
 * The core's registry: Codex offers only the CLI conversation, which the ADE no longer shows, and
 * a stand-in third provider offers the native one.
 */
const registry = {
  providers: [
    provider("claude", "Claude Code", true),
    provider("codex", "Codex", false, false),
    provider("stand-in", "Stand-in Agent", true),
  ],
  defaultProvider: "claude",
};

/** What the ADE keeps: the providers with the native conversation. */
const offered = { ...registry, providers: [registry.providers[0]!, registry.providers[2]!] };

/** Commands that answer `provider.list` from `answer` and count the calls. */
function commands(answer: () => Promise<unknown>) {
  const calls: string[] = [];
  const fake = {
    run(command: string) {
      calls.push(command);
      return answer();
    },
  } as unknown as ApplicationCommands;
  return { fake, calls };
}

beforeEach(() => {
  useProviderStore.setState({ registry: { status: "unknown" } });
  useWorkspaceStore.setState({ advertisedCommands: null });
});

describe("the provider registry", () => {
  it("never asks a core that did not advertise the provider list", async () => {
    const host = commands(() => Promise.resolve(registry));
    await loadProviders(host.fake, ["workspace.start", "workspace.list", "repository.list"]);
    expect(host.calls).toEqual([]);
    expect(useProviderStore.getState().registry).toEqual({ status: "older" });
  });

  it("loads the list from a core that advertised it, and keeps it when a reload fails", async () => {
    await loadProviders(commands(() => Promise.resolve(registry)).fake, ["provider.list"]);
    expect(useProviderStore.getState().registry).toEqual({ status: "loaded", ...offered });
    const failing = commands(() => Promise.reject(new RequestFailure("application_timeout")));
    await loadProviders(failing.fake, ["provider.list"]);
    expect(useProviderStore.getState().registry.status).toBe("loaded");
  });

  it("records a failure when no list loaded before", async () => {
    const failing = commands(() => Promise.reject(new RequestFailure("application_timeout")));
    await loadProviders(failing.fake, ["provider.list"]);
    expect(useProviderStore.getState().registry).toEqual({
      status: "failed",
      code: "application_timeout",
    });
  });

  it("chooses the last installed choice, then the default, then the first installed", () => {
    const loaded = { status: "loaded", ...registry } as const;
    expect(chooseProvider(loaded, "stand-in")?.provider).toBe("stand-in");
    expect(chooseProvider(loaded, "codex")?.provider).toBe("claude");
    expect(chooseProvider(loaded, "")?.provider).toBe("claude");
    const noDefault = { ...loaded, defaultProvider: "codex" };
    expect(chooseProvider(noDefault, "")?.provider).toBe("claude");
    expect(chooseProvider({ status: "older" }, "claude")).toBeNull();
  });

  it("loads once per connection, after the first advertised workspace list", async () => {
    let listener: (state: ConnectionState) => void = () => undefined;
    const client = {
      onState(next: (state: ConnectionState) => void) {
        listener = next;
        return () => undefined;
      },
    };
    const host = commands(() => Promise.resolve(registry));
    const unbind = bindProviders({ client, commands: host.fake });
    expect(host.calls).toEqual([]);
    useWorkspaceStore.setState({ advertisedCommands: ["provider.list"] });
    useWorkspaceStore.setState({ advertisedCommands: ["provider.list"] });
    expect(host.calls).toEqual(["provider.list"]);
    listener("connected");
    useWorkspaceStore.setState({ advertisedCommands: ["provider.list"] });
    expect(host.calls).toEqual(["provider.list", "provider.list"]);
    unbind();
  });
});
