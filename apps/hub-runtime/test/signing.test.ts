import { afterEach, describe, expect, it } from "vitest";

import {
  assertHubRuntimeSigningReplacement,
  loadHubRuntimeConfig,
  loadHubRuntimeSigning,
  ReloadableCommandSigner,
  ReloadablePolicySigner,
} from "../src/index.js";
import {
  availablePort,
  enableRuntimeSigningFile,
  removeTemporaryRoots,
  runtimeConfigFixture,
  temporaryRoot,
  writeRotatedRuntimeSigning,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub runtime signing snapshot rotation", () => {
  it("rotates policy and command signers together and rejects key reuse under an old ID", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    await enableRuntimeSigningFile(root, fixture);
    const config = await loadHubRuntimeConfig(fixture.configPath);
    const initial = await loadHubRuntimeSigning(config);
    const policy = new ReloadablePolicySigner(initial.policy);
    const command = new ReloadableCommandSigner(initial.command);

    const rotatedIds = await writeRotatedRuntimeSigning(root);
    const rotated = await loadHubRuntimeSigning(config);
    expect(() => assertHubRuntimeSigningReplacement(initial, rotated)).not.toThrow();
    policy.replace(rotated.policy);
    command.replace(rotated.command);
    expect(policy.keyId).toBe(rotatedIds.policyKeyId);
    expect(command.keyId).toBe(rotatedIds.commandKeyId);

    await writeRotatedRuntimeSigning(root, {
      policyKeyId: rotatedIds.policyKeyId,
      commandKeyId: rotatedIds.commandKeyId,
    });
    const reusedIds = await loadHubRuntimeSigning(config);
    expect(() => assertHubRuntimeSigningReplacement(rotated, reusedIds)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
  });
});
