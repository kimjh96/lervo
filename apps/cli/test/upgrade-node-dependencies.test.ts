import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error The production service renderer is plain ESM.
import { formatRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";
import { runtimeModuleHash } from "@lervo/runtime-security";

import {
  materializeNodeRuntimeModule,
  readNodeRuntimeModule,
  type NodeRuntimeModule,
} from "../src/node-fleet-runtime-module.js";
import type { InstalledNodeLauncher } from "../src/node-fleet-runtime-material.js";
import { describeRuntimeDependencies } from "../src/runtime-dependency-closure.js";
import { materializeRuntimeDependencies } from "../src/runtime-dependency-materialization.js";
import { inspectRegisteredNodeUpgrade, applyRegisteredNodeUpgrade } from "../src/upgrade-node.js";

const fixture = vi.hoisted(() => ({
  registration: {} as Record<string, unknown>,
  plan: {} as Record<string, unknown>,
  launcher: {} as Record<string, unknown>,
  config: "",
  apply: vi.fn(),
}));
vi.mock("@lervo/repository-registry", async (original) => ({
  ...(await original<typeof import("@lervo/repository-registry")>()),
  listNodeFleetInstances: async () => [fixture.registration],
  createNodeFleetOnboardingPlan: async () => fixture.plan,
}));
vi.mock("../src/node-service-coordinates.js", () => ({
  readNodeServiceCoordinates: async () => ({
    executable: fixture.launcher.launcher,
    config: fixture.config,
  }),
}));
vi.mock("../src/node-service-tool-directories.js", () => ({
  nodeServiceToolDirectories: async () => ({ directories: [], missing: [] }),
}));
vi.mock("../src/node-config-executable-upgrade.js", () => ({
  inspectNodeConfigExecutables: async () => ({ stage: { disposition: "current" } }),
  nodeConfigExecutablesPending: () => false,
}));
vi.mock("../src/node-fleet-apply.js", () => ({
  inspectNodeFleetStatus: async () => ({
    instances: [{ projectId: "prj_dependency", recoveryAction: "none" }],
  }),
  applyNodeFleetOnboarding: (...args: unknown[]) => fixture.apply(...args),
}));
vi.mock("../src/node-fleet-runtime-material.js", async (original) => ({
  ...(await original<typeof import("../src/node-fleet-runtime-material.js")>()),
  describeInstalledNodeLauncher: async () => fixture.launcher,
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-dependencies-"));
  const sdk = resolve(root, "source/node_modules/fixture-sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(
    resolve(sdk, "package.json"),
    JSON.stringify({ name: "fixture-sdk", version: "1", main: "index.js" }),
  );
  await writeFile(resolve(sdk, "index.js"), "module.exports = {};\n");
  const dependencies = await describeRuntimeDependencies(
    resolve(root, "source/consumer.js"),
    "fixture-sdk",
  );
  // An installed launcher always carries the exact repository runtime module it serves.
  const moduleSource = resolve(root, "module-source");
  await mkdir(moduleSource);
  const moduleBytes = Buffer.from("export const identity = 1;\n");
  await writeFile(resolve(moduleSource, "repository-runtime.js"), moduleBytes);
  await writeFile(
    resolve(moduleSource, "repository-runtime.json"),
    JSON.stringify({
      schemaVersion: 1,
      entry: "repository-runtime.js",
      files: [
        {
          name: "repository-runtime.js",
          size: moduleBytes.length,
          sha256: runtimeModuleHash(moduleBytes),
        },
      ],
    }) + "\n",
  );
  const runtimeModule = await readNodeRuntimeModule(moduleSource);
  const runtime = resolve(root, "runtime");
  await mkdir(runtime);
  const launcher = resolve(runtime, "launcher");
  const payload = resolve(runtime, "node-runtime.js");
  const payloadBytes = Buffer.from("payload\n");
  const launcherContent = "launcher\n";
  await writeFile(launcher, launcherContent);
  await writeFile(payload, payloadBytes);
  fixture.launcher = {
    launcher,
    payload,
    payloadBytes,
    launcherContent,
    dependencies,
    runtimeModule,
    hash: `sha256:${"a".repeat(64)}`,
  };
  fixture.config = resolve(root, "config.json");
  fixture.registration = {
    projectId: "prj_dependency",
    repositoryRoot: root,
    nodeId: "node_dependency",
    destinationId: "hub:test",
    serviceManager: "launchd",
    runtimeVersion: "0.20.0",
  };
  const definition = formatRuntimeServiceDefinition({
    manager: "launchd",
    runtime: "node",
    instance: "nfi_0123456789abcdef01234567",
    executable: launcher,
    config: fixture.config,
    pathDirectories: [],
  });
  fixture.plan = {
    planId: "plan_dependency",
    desired: { serviceManager: "launchd", serviceInstanceId: "nfi_0123456789abcdef01234567" },
    registry: { reconciliation: "unchanged" },
    service: {
      legacyTargetState: "absent",
      targetState: "present_unverified",
      targetPath: resolve(root, "service"),
      targetContentHash: `sha256:${createHash("sha256").update(definition).digest("hex")}`,
    },
  };
  fixture.apply.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Node upgrade installed dependency readiness", () => {
  it("plans a safe repair for a live exact deployment that has no SDK dependencies", async () => {
    const result = await inspectRegisteredNodeUpgrade(root, "prj_dependency", "0.20.0");
    expect(result.stage).toMatchObject({
      disposition: "safe_apply",
      reason: "node_runtime_dependencies_missing",
    });
    expect(result.replaceDeployment).toBe(true);
    await applyRegisteredNodeUpgrade(result);
    expect(fixture.apply).toHaveBeenCalledOnce();
  });

  it("describes and installs the runtime through the command's one description", async () => {
    const describeLauncher = vi.fn(
      async () => fixture.launcher as unknown as InstalledNodeLauncher,
    );
    const result = await inspectRegisteredNodeUpgrade(
      root,
      "prj_dependency",
      "0.20.0",
      describeLauncher,
    );
    expect(describeLauncher).toHaveBeenCalledOnce();
    await applyRegisteredNodeUpgrade(result, describeLauncher);
    expect(fixture.apply).toHaveBeenCalledWith(expect.objectContaining({ describeLauncher }));
  });

  it("reports current only after installed dependency bytes and links verify", async () => {
    await materializeRuntimeDependencies(
      resolve(root, "runtime"),
      fixture.launcher.dependencies as Awaited<ReturnType<typeof describeRuntimeDependencies>>,
    );
    await materializeNodeRuntimeModule(
      resolve(root, "runtime"),
      fixture.launcher.runtimeModule as NodeRuntimeModule,
    );
    expect(
      (await inspectRegisteredNodeUpgrade(root, "prj_dependency", "0.20.0")).stage,
    ).toMatchObject({ disposition: "current", reason: "exact_runtime_ready" });
  });

  it("blocks conflicting installed dependency content without applying a service change", async () => {
    await materializeRuntimeDependencies(
      resolve(root, "runtime"),
      fixture.launcher.dependencies as Awaited<ReturnType<typeof describeRuntimeDependencies>>,
    );
    await writeFile(resolve(root, "runtime/node_modules/.lervo-packages/0/index.js"), "conflict");
    expect(
      (await inspectRegisteredNodeUpgrade(root, "prj_dependency", "0.20.0")).stage,
    ).toMatchObject({ disposition: "blocked", reason: "node_runtime_dependency_conflict" });
    expect(fixture.apply).not.toHaveBeenCalled();
  });
});
