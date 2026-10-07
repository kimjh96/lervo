import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { nodeFleetServiceTargetPath } from "@lervo/repository-registry";
import { afterEach, describe, expect, it } from "vitest";

import { inspectRegisteredNodeExecutables } from "../src/node-config-executable-status.js";
import type { NodeFleetStatusReport } from "../src/node-fleet-apply-contract.js";
import { formatNodeFleetStatus } from "../src/node-fleet-status-format.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const registration = {
  serviceManager: "systemd" as const,
  serviceIdentity: "lervo-node-0123456789abcdef.service",
};

async function fixture(codex: (home: string) => string) {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-node-executables-status-")));
  directories.push(home);
  const repository = resolve(home, "repository");
  await mkdir(repository);
  const token = resolve(home, "node.token");
  const trust = resolve(home, "remote-trust.json");
  const config = resolve(home, "node-runtime.json");
  await writeFile(token, "fixture-token\n", { mode: 0o600 });
  await writeFile(trust, "{}\n", { mode: 0o600 });
  await writeFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: repository,
      hub: {
        baseUrl: "https://hub.example.test/",
        bearerTokenFile: token,
        destinationId: "hub:fixture",
        hubIdentityHash: `sha256:${"a".repeat(64)}`,
      },
      sync: { workerId: "node:fixture" },
      remoteCommands: {
        nodeId: "node_fixture_device_01",
        trustFile: trust,
        providerHost: {
          providers: ["codex"],
          roles: ["developer"],
          developerSkills: [],
          executables: { codex: codex(home) },
        },
      },
    })}\n`,
    { mode: 0o600 },
  );
  const definition = nodeFleetServiceTargetPath(
    home,
    registration.serviceManager,
    registration.serviceIdentity,
  );
  await mkdir(resolve(definition, ".."), { recursive: true });
  await writeFile(
    definition,
    `[Service]\nExecStart="${resolve(home, "launcher")}" --config "${config}"\n`,
    { mode: 0o600 },
  );
  await chmod(definition, 0o600);
  return home;
}

describe("repository Node status configured executables (ADR-0487)", () => {
  it("reports a removed CLI install by field and path before a restart", async () => {
    const pinned = (home: string) =>
      `${home}/.local/lib/lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js`;
    const home = await fixture(pinned);

    const report = await inspectRegisteredNodeExecutables({ registration, homeDirectory: home });

    expect(report).toEqual({
      status: "attention",
      missing: [
        {
          field: "remoteCommands.providerHost.executables.codex",
          path: pinned(home),
          kind: "provider",
          problem: "missing",
        },
      ],
      pinnedFields: ["remoteCommands.providerHost.executables.codex"],
    });
  });

  it("is ready when every configured executable resolves", async () => {
    const home = await fixture(() => process.execPath);
    await expect(
      inspectRegisteredNodeExecutables({ registration, homeDirectory: home }),
    ).resolves.toEqual({ status: "ready", missing: [], pinnedFields: [] });
  });

  it("is unavailable when the service definition cannot be read", async () => {
    const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-node-executables-none-")));
    directories.push(home);
    await expect(
      inspectRegisteredNodeExecutables({ registration, homeDirectory: home }),
    ).resolves.toEqual({ status: "unavailable", missing: [], pinnedFields: [] });
  });

  it("renders missing executables with the upgrade remedy", () => {
    const report: NodeFleetStatusReport = {
      schemaVersion: 1,
      status: "degraded",
      instances: [
        {
          projectId: "prj_fixture01",
          serviceInstanceId: "nfi_0123456789abcdef",
          repositoryRoot: "/repository",
          destinationId: "hub:fixture",
          runtimeVersion: "0.20.0",
          service: { managerAvailable: true, installed: true, active: true, enabled: true },
          runtime: {
            status: "ready",
            sync: "ready",
            workstreamReplication: "ready",
            workspaceCoordination: "disabled",
            remoteControl: "ready",
            conversation: "ready",
            supervision: "disabled",
            updatedAt: "2026-10-07T00:00:00.000Z",
          },
          recoveryAction: "none",
          configuredExecutables: {
            status: "attention",
            missing: [
              {
                field: "discordConversations[0].deliberation.cliExecutable",
                path: "/old/dist/bin.js",
                kind: "lervo_cli",
                problem: "missing",
              },
            ],
            pinnedFields: ["discordConversations[0].deliberation.cliExecutable"],
          },
        },
      ],
    };
    expect(formatNodeFleetStatus(report)).toBe(
      [
        "Repository Node fleet: degraded",
        "prj_fixture01 · nfi_0123456789abcdef · ready",
        "  sync=ready; workstream=ready; remote=ready; recovery=none",
        "  executables=attention; pinned=1",
        "  missing discordConversations[0].deliberation.cliExecutable: /old/dist/bin.js",
        "  Run `lervo upgrade` in this repository to point these fields at the host's stable CLI.",
        "",
      ].join("\n"),
    );
  });
});
