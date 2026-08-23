import { generateKeyPairSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseNodeRuntimeConfig } from "../src/config.js";
import { openNodeRemoteControlRuntime } from "../src/control-runtime.js";
import {
  nodeRuntimeFixture,
  nodeRuntimeHubIdentityHash,
  nodeRuntimeProjectId,
  nodeRuntimeToken,
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

const rotatedToken = "node-runtime-token-cccccccccccccccccccccccccc";

afterEach(removeTemporaryRoots);

describe("Node remote control bearer token snapshots", () => {
  it("reads the current token independently for policy and command HTTP requests", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, 8787);
    const commandKeys = generateKeyPairSync("ed25519");
    const policyKeys = generateKeyPairSync("ed25519");
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    await ownerFile(resolve(keyDirectory, "command.pem"), String(commandKeys.publicKey.export({
      type: "spki",
      format: "pem",
    })));
    await ownerFile(resolve(keyDirectory, "policy.pem"), String(policyKeys.publicKey.export({
      type: "spki",
      format: "pem",
    })));
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_runtime_credential_01",
      commandKeys: [{ keyId: "key_command_credential_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [{
        keyId: "key_policy_credential_01",
        publicKeyFile: "keys/policy.pem",
        purposes: ["snapshot", "approval", "revocation"],
      }],
      idlePollIntervalMs: 100,
      retryDelayMs: 1_000,
    };
    const config = parseNodeRuntimeConfig(configured, root);
    const target = {
      projectId: nodeRuntimeProjectId,
      projectIdentityHash: `sha256:${"7".repeat(64)}`,
    };
    let currentToken = nodeRuntimeToken;
    const policyTokens: string[] = [];
    const commandTokens: string[] = [];
    const abort = new AbortController();
    const runtime = await openNodeRemoteControlRuntime({
      config,
      token: () => currentToken,
      target,
      stateDirectory: resolve(fixture.repositoryRoot, ".lervo/state"),
      ports: {
        executor: {
          execute: async () => ({
            runId: "run_node_runtime_credential_01",
            completedAt: "2026-08-22T00:00:00.000Z",
          }),
        },
        localPolicy: { resolve: async () => [] },
        clock: { now: () => "2026-08-22T00:00:00.000Z" },
        createPolicyTransport(options) {
          policyTokens.push(options.bearerToken);
          return {
            async pullPolicyBundle(input) {
              currentToken = rotatedToken;
              return {
                authentication: {
                  status: "verified",
                  destinationId: input.destinationId,
                  peerIdentityHash: nodeRuntimeHubIdentityHash,
                },
                body: null,
              };
            },
          };
        },
        createCommandTransport(options) {
          commandTokens.push(options.bearerToken);
          return {
            async pullRemoteCommands(input) {
              return {
                authentication: {
                  status: "verified",
                  destinationId: input.destinationId,
                  peerIdentityHash: nodeRuntimeHubIdentityHash,
                },
                body: [],
              };
            },
            async acknowledgeRemoteCommand() {
              throw new Error("unexpected acknowledgement");
            },
          };
        },
        createPayloadLoader: () => ({
          load: async () => { throw new Error("unexpected payload load"); },
        }),
        wait: {
          wait: async () => { abort.abort(); },
        },
      },
    });
    await expect(runtime.run(abort.signal)).resolves.toMatchObject({ status: "stopped" });
    runtime.close();
    expect(policyTokens).toEqual([nodeRuntimeToken]);
    expect(commandTokens).toEqual([rotatedToken]);
  });
});
