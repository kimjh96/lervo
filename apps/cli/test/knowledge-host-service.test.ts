import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyHostResidentService,
  inspectHostResidentService,
  type KnowledgeHostServicePorts,
} from "../src/knowledge-host-service.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

interface Fixture {
  home: string;
  state: string;
  target: string;
  ports: KnowledgeHostServicePorts;
  manage: ReturnType<typeof vi.fn>;
  status: {
    managerAvailable: boolean;
    installed: boolean;
    enabled: boolean | null;
    active: boolean;
  };
}

async function fixture(
  options: { wanted?: number; nodeServed?: number; platform?: NodeJS.Platform } = {},
): Promise<Fixture> {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-host-service-"));
  directories.push(home);
  const state = resolve(home, "state");
  const bin = resolve(home, "bin");
  await mkdir(bin, { recursive: true });
  for (const name of ["node", "bin.js", "codex", "gh", "git"]) {
    await writeFile(resolve(bin, name), "#!/bin/sh\n");
    await chmod(resolve(bin, name), 0o755);
  }
  const target = resolve(home, "Library", "LaunchAgents", "com.lervo.knowledge.host.plist");
  const status = { managerAvailable: true, installed: false, enabled: null, active: false };
  const manage = vi.fn(async (args: string[]) => {
    const action = args[args.indexOf("--action") + 1];
    if (action === "status") return { ...status };
    const definition = await readFile(args[args.indexOf("--definition") + 1]!);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, definition, { mode: 0o600 });
    Object.assign(status, { installed: true, active: true });
    return { ...status, change: action === "upgrade" ? "upgraded" : "installed" };
  });
  const wanted = new Map(
    Array.from({ length: options.wanted ?? 1 }, (_, index) => [
      `/work/repository-${index}`,
      "codex" as const,
    ]),
  );
  return {
    home,
    state,
    target,
    manage,
    status,
    ports: {
      platform: options.platform ?? "darwin",
      homeDirectory: home,
      uid: 501,
      environment: { LERVO_USER_STATE_DIRECTORY: state, PATH: bin },
      cliEntry: async () => resolve(bin, "bin.js"),
      nodeExecutable: async () => resolve(bin, "node"),
      candidates: async () => ({
        wanted,
        nodeServed: Array.from({ length: options.nodeServed ?? 0 }, (_, i) => `/work/node-${i}`),
        notEnrolled: [],
      }),
      policyActive: async () => true,
      manage: manage as unknown as KnowledgeHostServicePorts["manage"],
      residentLaunch: async () => null,
    },
  };
}

describe("host resident service stage", () => {
  it("needs no service when every checkout is served by a Node or none is enrolled", async () => {
    const served = await fixture({ wanted: 0, nodeServed: 2 });
    expect(await inspectHostResidentService(served.ports)).toMatchObject({
      disposition: "current",
      reason: "all_repositories_node_served",
      action: "none",
      nodeServedRepositoryCount: 2,
    });
    expect(served.manage).not.toHaveBeenCalled();
    const idle = await fixture({ wanted: 0 });
    expect((await inspectHostResidentService(idle.ports)).reason).toBe("continuity_not_enrolled");
  });

  it("installs one launchd service with a captured configuration, then reports it current", async () => {
    const host = await fixture();
    const stage = await inspectHostResidentService(host.ports);
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "host_service_missing",
      action: "install",
      manager: "launchd",
      serviceIdentity: "com.lervo.knowledge.host",
      configAction: "create",
      servedRepositoryCount: 1,
    });
    expect(await applyHostResidentService(stage, host.ports)).toEqual({
      change: "installed",
      configCreated: true,
    });
    const install = host.manage.mock.calls.find((call) =>
      (call[0] as string[]).includes("install"),
    )![0] as string[];
    expect(install).toEqual(
      expect.arrayContaining(["--runtime", "knowledge-host", "--node-executable", "--write"]),
    );
    const config = JSON.parse(
      await readFile(resolve(host.state, "knowledge-host", "config.json"), "utf8"),
    );
    expect(config).toEqual({
      schemaVersion: 1,
      userStateDirectory: host.state,
      provider: null,
    });
    const definition = await readFile(host.target, "utf8");
    // Only the Node and CLI startup paths join the fixed system path.
    expect(definition).toContain(`<string>${resolve(host.home, "bin")}:/usr/local/sbin`);
    expect(install).not.toContain("--path-directories");
    expect(definition).toContain("<string>knowledge</string>");
    expect(definition).toContain("<string>--host</string>");
    expect(await inspectHostResidentService(host.ports)).toMatchObject({
      disposition: "current",
      reason: "host_service_current",
      configAction: "unchanged",
    });
  });

  it("replaces an outdated definition through the exact-predecessor upgrade and keeps the config", async () => {
    const host = await fixture();
    await applyHostResidentService(await inspectHostResidentService(host.ports), host.ports);
    const configPath = resolve(host.state, "knowledge-host", "config.json");
    const edited = JSON.parse(await readFile(configPath, "utf8"));
    edited.provider = "claude";
    await writeFile(configPath, JSON.stringify(edited), { mode: 0o600 });
    const moved = resolve(host.home, "bin", "next-bin.js");
    await writeFile(moved, "#!/bin/sh\n");
    host.ports.cliEntry = async () => moved;
    const stage = await inspectHostResidentService(host.ports);
    expect(stage).toMatchObject({ action: "upgrade", reason: "host_service_outdated" });
    expect(await applyHostResidentService(stage, host.ports)).toMatchObject({
      change: "upgraded",
      configCreated: false,
    });
    const upgrade = host.manage.mock.calls.at(-1)![0] as string[];
    expect(upgrade).toContain("--previous-definition");
    expect(JSON.parse(await readFile(configPath, "utf8")).provider).toBe("claude");
  });

  it("replaces an installed definition that froze an old provider directory into PATH", async () => {
    const host = await fixture();
    await applyHostResidentService(await inspectHostResidentService(host.ports), host.ports);
    const obsolete = "/owner/.nvm/versions/node/v20.0.0/bin";
    const definition = await readFile(host.target, "utf8");
    await writeFile(
      host.target,
      definition.replace(
        `${resolve(host.home, "bin")}:/usr/local/sbin`,
        `${obsolete}:${resolve(host.home, "bin")}:/usr/local/sbin`,
      ),
    );
    const stage = await inspectHostResidentService(host.ports);
    expect(stage).toMatchObject({ action: "upgrade", reason: "host_service_outdated" });
    await applyHostResidentService(stage, host.ports);
    expect(await readFile(host.target, "utf8")).not.toContain(obsolete);
    expect(host.manage.mock.calls.at(-1)![0]).toContain("--previous-definition");
    expect((await inspectHostResidentService(host.ports)).reason).toBe("host_service_current");
  });

  it("plans the host service even when no provider exists on the planning PATH", async () => {
    const host = await fixture();
    await rm(resolve(host.home, "bin", "codex"));
    expect(await inspectHostResidentService(host.ports)).toMatchObject({
      disposition: "safe_apply",
      reason: "host_service_missing",
      blockers: [],
    });
  });

  it("refuses a stale approval and blocks with a remedy when the manager is unavailable", async () => {
    const host = await fixture();
    const stage = await inspectHostResidentService(host.ports);
    await expect(
      applyHostResidentService(
        { ...stage, definitionHash: `sha256:${"0".repeat(64)}` },
        host.ports,
      ),
    ).rejects.toMatchObject({ code: "host_service_plan_stale" });
    host.status.managerAvailable = false;
    const linux = await fixture({ platform: "linux" });
    linux.status.managerAvailable = false;
    expect(await inspectHostResidentService(linux.ports)).toMatchObject({
      disposition: "blocked",
      reason: "service_manager_unavailable",
      blockers: [expect.objectContaining({ message: expect.stringContaining("systemd=true") })],
    });
    const windows = await fixture({ platform: "win32" });
    expect(await inspectHostResidentService(windows.ports)).toMatchObject({
      disposition: "pending_authority",
      reason: "service_manager_unsupported",
    });
  });

  it("flags a hand-run host resident that the managed service will replace", async () => {
    const host = await fixture();
    host.ports.residentLaunch = async () => "manual";
    expect(await inspectHostResidentService(host.ports)).toMatchObject({
      unmanagedResidentRunning: true,
      action: "install",
    });
  });
});

it.each(["darwin", "linux"] as const)(
  "upgrade on %s omits independently installed provider directories",
  async (platform) => {
    const host = await fixture({ platform });
    const tools = resolve(host.home, "provider-only-bin");
    await mkdir(tools);
    await writeFile(resolve(tools, "codex"), "#!/bin/sh\n", { mode: 0o700 });
    host.ports.environment.PATH = tools;
    const stage = await inspectHostResidentService(host.ports);
    expect(stage.disposition).toBe("safe_apply");
    await applyHostResidentService(stage, host.ports);
    const rendered = await readFile(host.target, "utf8");
    expect(rendered).not.toContain(tools);
    expect(host.manage.mock.calls.at(-1)![0]).not.toContain("--path-directories");
    expect(rendered).toContain(resolve(host.home, "bin", "node"));
  },
);
