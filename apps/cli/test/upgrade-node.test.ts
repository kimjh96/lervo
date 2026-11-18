import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  calculateNodeFleetServiceInstanceId,
  nodeFleetServiceIdentity,
} from "@lervo/repository-registry";
import { applyInitPlan, createInitPlan, loadProjectManifest } from "@lervo/project";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { inspectRegisteredNodeUpgrade, parseNodeServiceCoordinates } from "../src/upgrade-node.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.LERVO_USER_STATE_DIRECTORY;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository upgrade Node service recovery", () => {
  it("recovers exact launchd coordinates without exposing unrelated service fields", () => {
    expect(
      parseNodeServiceCoordinates(
        "launchd",
        `<?xml version="1.0"?>
<plist><dict>
<key>Label</key><string>com.lervo.node.fixture</string>
<key>ProgramArguments</key><array>
<string>/Users/example/Lervo &amp; tools/node</string>
<string>--config</string>
<string>/Users/example/Lervo &amp; tools/config.json</string>
</array>
</dict></plist>
`,
      ),
    ).toEqual({
      executable: "/Users/example/Lervo & tools/node",
      config: "/Users/example/Lervo & tools/config.json",
    });
  });

  it("recovers escaped systemd coordinates and rejects noncanonical commands", () => {
    expect(
      parseNodeServiceCoordinates(
        "systemd",
        `[Service]
ExecStart="/home/example/Lervo%%20/bin/node" --config "/home/example/Lervo%%20/config.json"
`,
      ),
    ).toEqual({
      executable: "/home/example/Lervo%20/bin/node",
      config: "/home/example/Lervo%20/config.json",
    });
    expect(parseNodeServiceCoordinates("systemd", "ExecStart=/bin/sh -c unsafe\n")).toBeNull();
    expect(
      parseNodeServiceCoordinates(
        "launchd",
        "<key>ProgramArguments</key><array><string>/bin/sh</string></array>",
      ),
    ).toBeNull();
  });

  it("leaves a registered Node pending when repository Hub sync is disabled", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-node-disabled-sync-"));
    roots.push(root);
    const repositoryRoot = resolve(root, "repository");
    await mkdir(repositoryRoot);
    await applyInitPlan(
      await createInitPlan({
        root: repositoryRoot,
        name: "disabled-sync",
        projectId: "prj_disabledsync01",
        now: new Date("2026-08-25T00:00:00.000Z"),
      }),
    );
    const manifest = await loadProjectManifest(repositoryRoot);
    expect(await readFile(resolve(repositoryRoot, ".lervo/project.yaml"), "utf8")).toContain(
      "hubSyncEnabled: false",
    );
    const repositoryIdentityHash = calculateProjectIdentityHash(manifest);
    const serviceInstanceId = calculateNodeFleetServiceInstanceId({
      projectId: manifest.projectId,
      repositoryIdentityHash,
      nodeId: "node_disabled_sync_01",
    });
    const state = resolve(root, "state");
    await mkdir(state, { mode: 0o700 });
    process.env.LERVO_USER_STATE_DIRECTORY = state;
    await writeFile(
      resolve(state, "node-fleet.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_node_fleet_registry",
          instances: [
            {
              serviceInstanceId,
              projectId: manifest.projectId,
              repositoryIdentityHash,
              repositoryRoot,
              nodeId: "node_disabled_sync_01",
              destinationId: "hub:fixture",
              runtimeVersion: "0.11.4",
              serviceManager: "launchd",
              serviceIdentity: nodeFleetServiceIdentity("launchd", serviceInstanceId),
              healthPath: resolve(repositoryRoot, ".lervo/state/node-runtime-health.json"),
              registeredAt: "2026-08-25T00:00:00.000Z",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await chmod(resolve(state, "node-fleet.json"), 0o600);

    await expect(
      inspectRegisteredNodeUpgrade(repositoryRoot, manifest.projectId, "0.16.7"),
    ).resolves.toMatchObject({
      stage: {
        disposition: "lervo_debt",
        registered: true,
        planId: null,
        reason: "node_sync_policy_disabled",
      },
      plan: null,
      configPath: null,
    });
  });
});
