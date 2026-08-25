import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadHubRuntimeConfig, parseHubRuntimeConfig } from "../src/index.js";
import {
  availablePort,
  enableRuntimeTls,
  enableRuntimeSigningFile,
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
      credentialsFile: resolve(root, "credentials.json"),
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
    expect(() => parseHubRuntimeConfig(publicBinding, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );

    expect(() => parseHubRuntimeConfig({ ...fixture.value, unexpected: true }, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );

    const inconsistent = structuredClone(fixture.value);
    inconsistent.cleanup = { workerId: "hub:runtime-test", limit: 100, maximumScannedObjects: 50 };
    expect(() => parseHubRuntimeConfig(inconsistent, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
  });

  it("allows a public binding only with complete TLS file coordinates", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    (fixture.value.listen as Record<string, unknown>).host = "0.0.0.0";
    await enableRuntimeTls(root, fixture);
    await expect(loadHubRuntimeConfig(fixture.configPath)).resolves.toMatchObject({
      listen: { host: "0.0.0.0" },
      tls: {
        certificatePath: resolve(root, "tls.crt"),
        privateKeyPath: resolve(root, "tls.key"),
      },
    });

    const incomplete = structuredClone(fixture.value);
    incomplete.tls = { certificatePath: "tls.crt" };
    expect(() => parseHubRuntimeConfig(incomplete, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
  });

  it("loads a strict external signing snapshot relative to its own directory", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    await enableRuntimeSigningFile(root, fixture);
    await expect(loadHubRuntimeConfig(fixture.configPath)).resolves.toMatchObject({
      signingFile: resolve(root, "signing.json"),
    });
    const both = structuredClone(fixture.value);
    both.signing = {
      policy: { keyId: "key_runtime_policy_01", privateKeyPath: "policy.pem" },
      command: { keyId: "key_runtime_command_01", privateKeyPath: "command.pem" },
    };
    expect(() => parseHubRuntimeConfig(both, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
  });
});
