import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  createNodeFleetOnboardingPlan,
  registerNodeFleetInstance,
} from "@lervo/repository-registry";
import { afterEach, describe, expect, it } from "vitest";

import { resolveDistributedReaderInventorySource } from "../src/event-reader-inventory-source.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("distributed reader inventory source", () => {
  it("resolves one exact fleet registration through its service and owner-only config", async () => {
    const fixture = await mkdtemp(resolve(tmpdir(), "lervo-reader-source-"));
    roots.push(fixture);
    const repositoryRoot = resolve(fixture, "repository");
    await mkdir(repositoryRoot);
    await applyInitPlan(
      await createInitPlan({
        root: repositoryRoot,
        projectId: "prj_inventory_source",
        now: new Date("2026-09-01T08:00:00.000Z"),
      }),
    );
    const manifestPath = resolve(repositoryRoot, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const registryPath = resolve(fixture, "state/node-fleet.json");
    await mkdir(resolve(registryPath, ".."), { recursive: true, mode: 0o700 });
    await chmod(resolve(registryPath, ".."), 0o700);
    const coordinates = {
      registryPath,
      repositoryRoot: await realpath(repositoryRoot),
      nodeId: "node_inventory_source",
      destinationId: "hub:inventory-source",
      runtimeVersion: "0.8.2",
      serviceManager: "systemd" as const,
    };
    await registerNodeFleetInstance(coordinates);
    const homeDirectory = resolve(fixture, "home");
    const plan = await createNodeFleetOnboardingPlan({ ...coordinates, homeDirectory });
    const configPath = resolve(fixture, "node-config.json");
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repositoryRoot,
        hub: {
          baseUrl: "https://hub.example.test/",
          bearerTokenFile: resolve(fixture, "hub.token"),
          destinationId: coordinates.destinationId,
          hubIdentityHash: `sha256:${"a".repeat(64)}`,
        },
        sync: { workerId: "node:inventory-source" },
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(configPath, 0o600);
    await mkdir(resolve(plan.service.targetPath, ".."), { recursive: true });
    await writeFile(
      plan.service.targetPath,
      `[Service]\nExecStart="/opt/lervo/node" --config "${configPath}"\n`,
      { mode: 0o600 },
    );
    await chmod(plan.service.targetPath, 0o600);

    await expect(
      resolveDistributedReaderInventorySource({
        repositoryRoot,
        registryPath,
        homeDirectory,
      }),
    ).resolves.toMatchObject({
      projectId: "prj_inventory_source",
      repositoryRoot: coordinates.repositoryRoot,
      registration: { nodeId: coordinates.nodeId, destinationId: coordinates.destinationId },
      nodeConfig: { hub: { baseUrl: "https://hub.example.test/" } },
      inventoryHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });
});
