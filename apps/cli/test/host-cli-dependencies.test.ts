import { describe, expect, it } from "vitest";

import {
  closureOverrides,
  compareInstalledClosure,
  virtualStoreCoordinate,
} from "../src/host-cli-dependencies.js";

describe("host CLI dependency closure", () => {
  it("reads package coordinates from pnpm virtual-store names", () => {
    expect(virtualStoreCoordinate("ajv-formats@3.0.1_ajv@8.20.0")).toEqual({
      name: "ajv-formats",
      version: "3.0.1",
    });
    expect(
      virtualStoreCoordinate(
        "@anthropic-ai+claude-agent-sdk@0.3.226_@anthropic-ai+sdk@0.117.1_zod@4.4.3__@modelconte_b463b4ac",
      ),
    ).toEqual({ name: "@anthropic-ai/claude-agent-sdk", version: "0.3.226" });
    expect(virtualStoreCoordinate("@lervo+cli@file+..+share+lervo-cli-0.23.7.tgz")).toBeNull();
    expect(virtualStoreCoordinate("node_modules")).toBeNull();
    expect(virtualStoreCoordinate("lock.yaml")).toBeNull();
  });

  it("pins single versions by name and repeated names by major or minor", () => {
    expect(
      closureOverrides({
        portable: ["zod@4.4.3", "content-type@1.0.5", "content-type@2.1.0", "x@0.7.1", "x@0.8.0"],
        platformFamilies: [],
      }),
    ).toEqual({
      "content-type@1": "1.0.5",
      "content-type@2": "2.1.0",
      "x@0.7": "0.7.1",
      "x@0.8": "0.8.0",
      zod: "4.4.3",
    });
    expect(closureOverrides({ portable: ["y@1.0.0", "y@1.2.0"], platformFamilies: [] })).toEqual(
      {},
    );
  });

  it("accepts exactly the closure plus this platform's family packages", () => {
    const closure = {
      portable: ["@babel/runtime@7.29.7", "zod@4.4.3"],
      platformFamilies: [{ prefix: "@anthropic-ai/claude-agent-sdk-", version: "0.3.226" }],
    };
    expect(
      compareInstalledClosure(
        [
          "@babel+runtime@7.29.7",
          "zod@4.4.3",
          "@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.226",
          "node_modules",
        ],
        closure,
      ),
    ).toEqual({ unexpected: [], missing: [] });
    // The drift observed on the v0.23.7 Mac install: a newer transitive release resolved instead.
    expect(
      compareInstalledClosure(
        ["@babel+runtime@7.29.14", "zod@4.4.3", "@anthropic-ai+claude-agent-sdk-linux-x64@0.3.300"],
        closure,
      ),
    ).toEqual({
      unexpected: ["@anthropic-ai/claude-agent-sdk-linux-x64@0.3.300", "@babel/runtime@7.29.14"],
      missing: ["@babel/runtime@7.29.7"],
    });
  });
});
