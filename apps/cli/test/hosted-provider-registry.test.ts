import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultHostedProvider,
  hostedProviderModes,
  listHostedProviders,
  resolveHostedSessionAdapter,
} from "../src/hosted-session-adapters.js";

describe("the hosted provider registry", () => {
  it("lists each provider's name, capabilities, modes, and installation", async () => {
    const bin = await mkdtemp(join(tmpdir(), "lervo-providers-"));
    await writeFile(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const { providers, defaultProvider } = await listHostedProviders({ PATH: bin });
    expect(defaultProvider).toBe(defaultHostedProvider);
    expect(providers.map((entry) => entry.provider)).toContain(defaultProvider);
    const claude = providers.find((entry) => entry.provider === "claude");
    const codex = providers.find((entry) => entry.provider === "codex");
    expect(claude).toMatchObject({
      displayName: "Claude Code",
      conversationModes: ["native", "cli"],
      preferredMode: "native",
      installed: true,
    });
    expect(codex).toMatchObject({
      displayName: "Codex",
      conversationModes: ["cli"],
      preferredMode: "cli",
      installed: false,
    });
    for (const entry of providers)
      expect(entry.conversationModes.includes("native")).toBe(
        entry.capabilities.nativeConversation,
      );
  });

  it("reports a signed-out provider and refuses to launch it", async () => {
    const bin = await mkdtemp(join(tmpdir(), "lervo-providers-signed-out-"));
    // The provider answers its status probe with no one signed in.
    await writeFile(join(bin, "claude"), "#!/bin/sh\necho '{\"loggedIn\":false}'\nexit 1\n", {
      mode: 0o755,
    });
    const environment = { PATH: bin, HOME: bin };
    const { providers } = await listHostedProviders(environment);
    expect(providers.find((entry) => entry.provider === "claude")).toMatchObject({
      installed: true,
      signedIn: false,
    });
    expect(providers.find((entry) => entry.provider === "codex")?.signedIn).toBeNull();
    await expect(resolveHostedSessionAdapter("claude", environment)).rejects.toMatchObject({
      code: "provider_login_unavailable",
    });
  });

  it("gives a workspace its provider's modes, and none for an unknown provider", () => {
    expect(hostedProviderModes("claude")).toEqual(["native", "cli"]);
    expect(hostedProviderModes("codex")).toEqual(["cli"]);
    expect(hostedProviderModes("retired")).toBeNull();
  });
});
