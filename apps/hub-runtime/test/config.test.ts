import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadHubRuntimeConfig, parseHubRuntimeConfig } from "../src/index.js";
import {
  availablePort,
  removeTemporaryRoots,
  runtimeConfigFixture,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub runtime configuration", () => {
  it("loads only a strict owner-only config and resolves paths from the config directory", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    await expect(loadHubRuntimeConfig(fixture.configPath)).resolves.toMatchObject({
      storage: {
        databasePath: fixture.databasePath,
        commandCasPath: resolve(root, "state/command-cas"),
      },
      signing: {
        policy: { privateKeyPath: resolve(root, "policy.pem") },
        command: { privateKeyPath: resolve(root, "command.pem") },
      },
      control: { reviewGrantSecretPath: resolve(root, "review.secret") },
    });

    await chmod(fixture.configPath, 0o644);
    await expect(loadHubRuntimeConfig(fixture.configPath)).rejects.toMatchObject({
      code: "unsafe_runtime_file",
    });
  });

  it("rejects public plaintext binding, unknown fields, and inconsistent cleanup bounds", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    const publicBinding = structuredClone(fixture.value);
    (publicBinding.listen as Record<string, unknown>).host = "0.0.0.0";
    expect(() => parseHubRuntimeConfig(publicBinding, root)).toThrow(expect.objectContaining({
      code: "invalid_config",
    }));

    expect(() => parseHubRuntimeConfig({ ...fixture.value, unexpected: true }, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );

    const inconsistent = structuredClone(fixture.value);
    inconsistent.cleanup = { workerId: "hub:runtime-test", limit: 100, maximumScannedObjects: 50 };
    expect(() => parseHubRuntimeConfig(inconsistent, root)).toThrow(expect.objectContaining({
      code: "invalid_config",
    }));
  });
});
