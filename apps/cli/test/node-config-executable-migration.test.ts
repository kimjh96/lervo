import { describe, expect, it } from "vitest";

import { planNodeConfigExecutableMigration } from "../src/node-config-executable-migration.js";

const HOME = "/home/jonghyeok";
const INSTALLS = `${HOME}/.local/lib/lervo-cli`;
const POINTER = `${HOME}/.local/share/lervo/runtimes/cli/current`;
const RUNTIMES = `${HOME}/.local/share/lervo/runtimes/node`;
const CONVERGENCE = `${INSTALLS}/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js`;
const SETTLED_A = `${INSTALLS}/settled-3bd3a1c6-r1/dist/bin.js`;
const SETTLED_B = `${INSTALLS}/settled-6c787cf8-r1/dist/bin.js`;
const RUNNING = `${INSTALLS}/open-collab-0.20.0-a2bd3c7b/node_modules/@lervo/cli`;

function conversation(index: number, cliExecutable: string) {
  return {
    integrationId: `discord-${index}`,
    deliberation: { cliExecutable, workerId: `deliberation-${index}` },
    requestedRuntimes: [
      {
        runtimeId: `knowledge-${index}`,
        executable: "/usr/bin/node",
        arguments: [CONVERGENCE, "knowledge", "convergence", "--watch"],
      },
    ],
  };
}

/** The shape of the WSL incident: 13 pins to one removed install and two settled builds. */
function incidentConfig() {
  return {
    schemaVersion: 1,
    repositoryRoot: `${HOME}/lervo`,
    discordConversations: [
      ...[0, 1, 2, 3, 4, 5].map((index) => conversation(index, CONVERGENCE)),
      conversation(6, SETTLED_A),
    ],
    outcomeSupervision: {
      managedExecution: { nodeExecutable: "/usr/bin/node", cliBundle: SETTLED_B },
      runtimeReadiness: {
        verificationTools: {
          "repo.check": [{ toolId: "lervo", executable: "/opt/tools/dist/bin.js" }],
        },
      },
    },
  };
}

function plan(document: unknown, options: { pointer?: boolean; running?: string | null } = {}) {
  return planNodeConfigExecutableMigration({
    content: `${JSON.stringify(document, null, 2)}\n`,
    cliPointerRoot: POINTER,
    runningInstallRoot: options.running === undefined ? RUNNING : options.running,
    nodeRuntimesDirectory: RUNTIMES,
    nodeRuntimePointerPresent: options.pointer ?? true,
  });
}

describe("Node configuration executable migration (ADR-0488)", () => {
  it("moves every pinned CLI install path in the incident configuration to the CLI pointer", () => {
    const result = plan(incidentConfig());

    expect(result.status).toBe("migrate");
    expect(result.rewrites.filter((item) => item.from === CONVERGENCE)).toHaveLength(13);
    expect(result.rewrites.map((item) => item.from).sort()).toEqual(
      [...Array(13).fill(CONVERGENCE), SETTLED_A, SETTLED_B].sort(),
    );
    expect(new Set(result.rewrites.map((item) => item.to))).toEqual(
      new Set([`${POINTER}/dist/bin.js`]),
    );
    expect(result.rewrites.map((item) => item.field)).toContain(
      "discordConversations[6].deliberation.cliExecutable",
    );
    expect(result.rewrites.map((item) => item.field)).toContain(
      "discordConversations[0].requestedRuntimes[0].arguments[0]",
    );
    expect(result.overrideFields).toEqual([]);

    const migrated = JSON.parse(result.migratedContent!);
    expect(JSON.stringify(migrated)).not.toContain(INSTALLS);
    // Everything that is not a CLI install path keeps its bytes.
    expect(migrated.outcomeSupervision.managedExecution.nodeExecutable).toBe("/usr/bin/node");
    expect(migrated.outcomeSupervision.runtimeReadiness.verificationTools["repo.check"]).toEqual([
      { toolId: "lervo", executable: "/opt/tools/dist/bin.js" },
    ]);
    expect(migrated.discordConversations[0].requestedRuntimes[0].arguments.slice(1)).toEqual([
      "knowledge",
      "convergence",
      "--watch",
    ]);
    expect(result.migratedHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("recognizes a sibling install through the running CLI's install parent", () => {
    const document = {
      discordConversations: [{ requestedRuntimes: [{ arguments: [SETTLED_A] }] }],
    };
    expect(plan(document).rewrites.map((item) => item.from)).toEqual([SETTLED_A]);
    // Without a CLI field or a package install in the same parent, the path is not a CLI install.
    expect(plan(document, { running: null }).status).toBe("current");
  });

  it("is current once the configuration names the pointer, and reports explicit overrides", () => {
    const pointed = {
      discordConversation: { deliberation: { cliExecutable: `${POINTER}/dist/bin.js` } },
      outcomeSupervision: { managedExecution: { cliBundle: "/usr/local/bin/lervo" } },
    };
    expect(plan(pointed)).toMatchObject({
      status: "current",
      migratedContent: null,
      rewrites: [],
      overrideFields: ["outcomeSupervision.managedExecution.cliBundle"],
    });
  });

  it("moves Node runtime pins to the runtime pointer only once it exists", () => {
    const document = {
      remoteCommands: {
        providerHost: { executables: { codex: `${RUNTIMES}/0123456789abcdef/node-runtime.js` } },
      },
    };
    expect(plan(document).rewrites).toEqual([
      {
        field: "remoteCommands.providerHost.executables.codex",
        kind: "node_runtime",
        from: `${RUNTIMES}/0123456789abcdef/node-runtime.js`,
        to: `${RUNTIMES}/current/node-runtime.js`,
      },
    ]);
    expect(plan(document, { pointer: false })).toMatchObject({
      status: "current",
      retainedFields: ["remoteCommands.providerHost.executables.codex"],
    });
  });

  it("refuses a configuration that is not a JSON object", () => {
    expect(
      planNodeConfigExecutableMigration({
        content: "not json",
        cliPointerRoot: POINTER,
        runningInstallRoot: RUNNING,
        nodeRuntimesDirectory: RUNTIMES,
        nodeRuntimePointerPresent: true,
      }).status,
    ).toBe("invalid");
  });
});
