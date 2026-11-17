import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The production service renderer is plain ESM.
import { formatRuntimeServiceDefinition } from "../../../scripts/distribution/render-runtime-service.mjs";

import { parseServiceConfigPath } from "../src/node-service-coordinate-parser.js";
import { nodeRuntimesDirectory, pointCurrentNodeRuntime } from "../src/node-runtime-pointer.js";
import { planNodeRuntimeRetention } from "../src/node-runtime-retention.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
const name = (index: number) => index.toString(16).padStart(16, "0");
const managers = { linux: "systemd", darwin: "launchd" } as const;

/** Nine retained runtimes, `current` at the oldest, and a state directory with a space in it. */
async function host(platform: "linux" | "darwin") {
  const homeDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-service-refs-")));
  homes.push(homeDirectory);
  const root = nodeRuntimesDirectory(homeDirectory, platform);
  for (let index = 1; index <= 9; index += 1) {
    const directory = resolve(root, name(index));
    await mkdir(directory, { recursive: true });
    const payload = resolve(directory, "node-runtime.js");
    await writeFile(payload, "export {};\n");
    await writeFile(
      resolve(directory, `lervo-node-launcher-${name(index).slice(0, 12)}`),
      `#!/bin/sh\nexec '/node' '${payload}' "$@"\n`,
    );
    await utimes(directory, new Date(index * 1000), new Date(index * 1000));
  }
  await pointCurrentNodeRuntime({ runtimeDirectory: name(1), homeDirectory, platform });
  const state = resolve(homeDirectory, "Application Support", "Lervo's state");
  await mkdir(state, { recursive: true });
  const services =
    platform === "darwin"
      ? resolve(homeDirectory, "Library/LaunchAgents")
      : resolve(homeDirectory, ".config/systemd/user");
  await mkdir(services, { recursive: true });
  return { homeDirectory, platform, root, state, services, manager: managers[platform] };
}

type Host = Awaited<ReturnType<typeof host>>;

/** Writes the exact bytes the production renderer installs for one runtime service. */
async function install(
  fixture: Host,
  file: string,
  input: { runtime: string; executable: string; config: string; nodeExecutable?: string },
  configText = "{}\n",
): Promise<void> {
  await writeFile(input.config, configText);
  await writeFile(
    resolve(fixture.services, fixture.platform === "darwin" ? `${file}.plist` : `${file}.service`),
    formatRuntimeServiceDefinition({
      manager: fixture.manager,
      ...(input.runtime === "node" ? { instance: "nfi_0123456789abcdef01234567" } : {}),
      pathDirectories: [],
      ...input,
    }) as string,
  );
}

/** A host's full set: a Node, the Hub, the follower, the host resident, and the replica. */
async function installFleet(fixture: Host): Promise<void> {
  const config = (file: string) => resolve(fixture.state, file);
  const cli = resolve(fixture.homeDirectory, "cli install", "dist", "bin.js");
  await install(fixture, "lervo-node-test", {
    runtime: "node",
    executable: resolve(fixture.root, name(2), `lervo-node-launcher-${name(2).slice(0, 12)}`),
    config: config("node.json"),
  });
  await install(fixture, "lervo-hub", {
    runtime: "hub",
    nodeExecutable: "/opt/node/bin/node",
    executable: resolve(fixture.homeDirectory, "hub release", "dist", "bin.js"),
    config: config("hub config.json"),
  });
  await install(fixture, "lervo-host-follow", {
    runtime: "host-follow",
    nodeExecutable: "/opt/node/bin/node",
    executable: cli,
    config: config("host-follow-service.json"),
  });
  await install(
    fixture,
    "lervo-knowledge-host",
    {
      runtime: "knowledge-host",
      nodeExecutable: "/opt/node/bin/node",
      executable: cli,
      config: config("knowledge-host.json"),
    },
    JSON.stringify({ runtime: resolve(fixture.root, name(4), "node-runtime.js") }),
  );
  await install(fixture, "lervo-repository-replica", {
    runtime: "repository-replica",
    nodeExecutable: "/opt/node/bin/node",
    executable: resolve(fixture.root, name(3), "node-runtime.js"),
    config: config("replica.json"),
  });
}

const plan = (fixture: Host) =>
  planNodeRuntimeRetention({ ...fixture, processCommands: async () => "" });

describe("runtime retention service references", () => {
  for (const platform of ["linux", "darwin"] as const) {
    it(`reads every rendered Lervo service on ${platform} and retires only unreferenced runtimes`, async () => {
      const fixture = await host(platform);
      await installFleet(fixture);
      const result = await plan(fixture);
      expect(result).toMatchObject({
        disposition: "safe_apply",
        reason: "runtime_retention_ready",
      });
      // current (1), the Node launcher (2), the replica payload (3), and the runtime the host
      // resident's configuration names (4) are referenced; 9 and 8 are the two recent others.
      expect(result.candidates.map((item) => item.name)).toEqual([name(7), name(6), name(5)]);
    });

    it(`defers retention on ${platform} when a definition names --config in another shape`, async () => {
      const fixture = await host(platform);
      await installFleet(fixture);
      const file = resolve(
        fixture.services,
        platform === "darwin" ? "lervo-host-follow.plist" : "lervo-host-follow.service",
      );
      const rendered = await readFile(file, "utf8");
      await writeFile(
        file,
        platform === "darwin"
          ? rendered.replace("</array>", "<string>--verbose</string>\n  </array>")
          : rendered.replace(/^(ExecStart=.*)$/mu, "$1 --verbose"),
      );
      expect(await plan(fixture)).toMatchObject({
        disposition: "deferred",
        reason: "runtime_references_unavailable",
        candidates: [],
      });
    });

    it(`defers retention on ${platform} when a referenced configuration is missing`, async () => {
      const fixture = await host(platform);
      await installFleet(fixture);
      await rm(resolve(fixture.state, "hub config.json"));
      expect(await plan(fixture)).toMatchObject({
        disposition: "deferred",
        reason: "runtime_references_unavailable",
      });
    });
  }

  it("protects every runtime a systemd drop-in names, including a PATH entry", async () => {
    const fixture = await host("linux");
    await installFleet(fixture);
    const dropIns = resolve(fixture.services, "lervo-node-test.service.d");
    await mkdir(dropIns);
    await writeFile(
      resolve(dropIns, "20-knowledge-provider-path.conf"),
      `[Service]\nEnvironment="PATH=/usr/bin:${resolve(fixture.root, name(7))}:/bin"\n`,
    );
    await mkdir(resolve(fixture.services, "service.d"));
    await writeFile(
      resolve(fixture.services, "service.d", "10-tools.conf"),
      `[Service]\nEnvironment="PATH=${resolve(fixture.root, name(6))}"\n`,
    );
    const result = await plan(fixture);
    expect(result.disposition).toBe("safe_apply");
    expect(result.candidates.map((item) => item.name)).toEqual([name(5)]);
  });

  it.each([
    [
      "resets the command",
      (launcher: string) => `[Service]\nExecStart=\nExecStart="${launcher}"\n`,
    ],
    [
      "names another configuration",
      () => `[Service]\nEnvironment="ARGS=--config /elsewhere.json"\n`,
    ],
  ])("defers retention when a systemd drop-in %s", async (_, conf) => {
    const fixture = await host("linux");
    await installFleet(fixture);
    const dropIns = resolve(fixture.services, "lervo-node-test.service.d");
    await mkdir(dropIns);
    await writeFile(
      resolve(dropIns, "override.conf"),
      conf(resolve(fixture.root, name(5), `lervo-node-launcher-${name(5).slice(0, 12)}`)),
    );
    expect(await plan(fixture)).toMatchObject({
      disposition: "deferred",
      reason: "runtime_references_unavailable",
      candidates: [],
    });
  });

  it("reads the configuration after subcommand words, quotes, escapes, and percent signs", () => {
    const config = '/home/o\'wner/50% "state"/config.json';
    for (const manager of ["systemd", "launchd"] as const)
      expect(
        parseServiceConfigPath(
          manager,
          formatRuntimeServiceDefinition({
            manager,
            runtime: "host-follow",
            nodeExecutable: "/opt/node/bin/node",
            executable: "/opt/lervo/dist/bin.js",
            config,
            pathDirectories: [],
          }) as string,
        ),
      ).toBe(config);
    expect(parseServiceConfigPath("systemd", 'ExecStart="/a" --config relative.json\n')).toBeNull();
    expect(
      parseServiceConfigPath("systemd", 'ExecStart="/a" --config "/b" --config "/c"\n'),
    ).toBeNull();
    expect(parseServiceConfigPath("systemd", 'ExecStart="/a" --config "/b\\x"\n')).toBeNull();
    expect(
      parseServiceConfigPath(
        "launchd",
        "<key>ProgramArguments</key><array><string>/a</string><string>--config</string><integer>1</integer></array>",
      ),
    ).toBeNull();
  });
});
