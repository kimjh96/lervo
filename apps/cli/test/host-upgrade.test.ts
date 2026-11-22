import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readActivationJournal,
  readHostLinks,
  recordActivation,
} from "../src/host-cli-activation.js";
import { createPnpmInstaller } from "../src/host-cli-install.js";
import { installedCliProbes } from "../src/host-link-activation.js";
import { rollbackActivation } from "../src/host-upgrade-rollback.js";
import { runHostCommand } from "../src/host-command.js";
import {
  applyReleaseUpgrade,
  planReleaseUpgrade,
  findPathShadow,
  type HostUpgradeDependencies,
} from "../src/host-upgrade.js";
import { hostUpgradeLayout } from "../src/host-upgrade-layout.js";
import {
  extractingInstaller,
  extractingInstallerWith,
  fakeReleaseSource,
  releaseFixture,
  startFixtureRegistry,
} from "./host-release-fixture.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function temporaryHome(): Promise<string> {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-host-upgrade-")));
  directories.push(home);
  return home;
}

function dependencies(
  home: string,
  overrides: Partial<HostUpgradeDependencies> = {},
): HostUpgradeDependencies {
  let counter = 0;
  return {
    layout: hostUpgradeLayout({ homeDirectory: home, platform: "linux" }),
    installer: extractingInstaller,
    probes: installedCliProbes,
    now: () => new Date("2026-11-16T00:00:00.000Z"),
    newActivationId: () => `hact_${String((counter += 1)).padStart(24, "0")}`,
    readCliPointer: async () => null,
    ...overrides,
  };
}

const exists = async (path: string) => (await lstat(path).catch(() => null)) !== null;

describe("planReleaseUpgrade", () => {
  it("plans a published release without writing anything", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const plan = await planReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps);
    expect(plan).toMatchObject({
      status: "ready",
      tag: "v9.9.9",
      version: "9.9.9",
      commit: "c".repeat(40),
    });
    expect(plan.links.map((link) => [link.name, link.previous])).toEqual([
      ["lervo", null],
      ["lervo-node", null],
    ]);
    expect(await exists(deps.layout.cliDirectory)).toBe(false);
    expect(await exists(deps.layout.binDirectory)).toBe(false);
  });

  it("refuses drafts, prereleases, and releases without the exact verified subjects", async () => {
    const home = await temporaryHome();
    const fixture = releaseFixture();
    await expect(
      planReleaseUpgrade(
        fakeReleaseSource([fixture], { draft: true }),
        "v9.9.9",
        dependencies(home),
      ),
    ).rejects.toMatchObject({ code: "host_release_not_published" });
    await expect(
      planReleaseUpgrade(
        fakeReleaseSource([fixture], { prerelease: true }),
        "v9.9.9",
        dependencies(home),
      ),
    ).rejects.toMatchObject({ code: "host_release_not_published" });
    fixture.assets.delete("release-subjects.json");
    await expect(
      planReleaseUpgrade(fakeReleaseSource([fixture]), "v9.9.9", dependencies(home)),
    ).rejects.toMatchObject({
      code: "host_release_assets_incomplete",
    });
  });
});

describe("applyReleaseUpgrade", () => {
  it("installs the verified release side by side, switches both links, and records the activation", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const source = fakeReleaseSource([releaseFixture()]);
    const result = await applyReleaseUpgrade(source, "v9.9.9", deps);
    expect(result.status).toBe("activated");
    if (result.status !== "activated") return;
    const installDirectory = resolve(deps.layout.installsDirectory, `9.9.9-${"c".repeat(12)}`);
    expect(result.activation.release).toMatchObject({ tag: "v9.9.9", installDirectory });
    const lervo = await readlink(resolve(deps.layout.binDirectory, "lervo"));
    expect(lervo.startsWith(installDirectory)).toBe(true);
    expect(lervo.endsWith("/dist/bin.js")).toBe(true);
    expect(
      (await readlink(resolve(deps.layout.binDirectory, "lervo-node"))).endsWith(
        "/dist/node-runtime.js",
      ),
    ).toBe(true);
    expect(
      execFileSync(process.execPath, [resolve(deps.layout.binDirectory, "lervo"), "--version"], {
        encoding: "utf8",
      }),
    ).toBe("lervo 9.9.9\n");
    expect(
      (await readActivationJournal(deps.layout)).map((record) => [
        record.activationId,
        record.outcome,
      ]),
    ).toEqual([[result.activation.activationId, "active"]]);
    expect(await exists(deps.layout.lockPath)).toBe(false);
    expect(await planReleaseUpgrade(source, "v9.9.9", deps)).toMatchObject({ status: "current" });

    const again = await applyReleaseUpgrade(source, "v9.9.9", deps);
    expect(again).toMatchObject({ status: "current", reusedInstall: true });
    expect(await readActivationJournal(deps.layout)).toHaveLength(1);
  });

  it("restores the previous links when the new executable fails its health check", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const first = await applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps);
    const before = await readlink(resolve(deps.layout.binDirectory, "lervo"));
    const broken = releaseFixture({
      version: "9.9.10",
      commit: "d".repeat(40),
      binSource: "process.exit(3);\n",
    });
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([broken]), "v9.9.10", deps),
    ).rejects.toMatchObject({
      code: "host_upgrade_health_failed",
    });
    expect(await readlink(resolve(deps.layout.binDirectory, "lervo"))).toBe(before);
    expect(
      (await readActivationJournal(deps.layout)).map((record) => [
        record.activationId,
        record.outcome,
      ]),
    ).toEqual([
      [first.status === "activated" ? first.activation.activationId : "", "active"],
      [`hact_${"2".padStart(24, "0")}`, "restored"],
    ]);
  });

  it("installs only the npm packages the release manifest names", async () => {
    const home = await temporaryHome();
    const fixture = releaseFixture({ portable: ["zod@4.4.3"] });
    const drifted = dependencies(home, {
      installer: extractingInstallerWith(["zod@4.4.3", "evil@7.0.7"]),
    });
    const failure = await applyReleaseUpgrade(
      fakeReleaseSource([fixture]),
      "v9.9.9",
      drifted,
    ).catch((error: unknown) => error as { code?: string; details?: unknown });
    expect(failure).toMatchObject({
      code: "host_upgrade_dependencies_mismatch",
      details: { unexpected: ["evil@7.0.7"], missing: [] },
    });
    expect(await exists(resolve(drifted.layout.binDirectory, "lervo"))).toBe(false);
    const missing = await applyReleaseUpgrade(
      fakeReleaseSource([fixture]),
      "v9.9.9",
      dependencies(home, { installer: extractingInstallerWith([]) }),
    ).catch((error: unknown) => error as { details?: unknown });
    expect(missing).toMatchObject({ details: { unexpected: [], missing: ["zod@4.4.3"] } });
    await expect(
      applyReleaseUpgrade(
        fakeReleaseSource([fixture]),
        "v9.9.9",
        dependencies(home, { installer: extractingInstallerWith(["zod@4.4.3"]) }),
      ),
    ).resolves.toMatchObject({ status: "activated" });
  });

  it("restores the links when lervo-node does not parse", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const broken = releaseFixture({ nodeRuntimeSource: "export {;\n" });
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([broken]), "v9.9.9", deps),
    ).rejects.toMatchObject({
      code: "host_upgrade_health_failed",
    });
    expect(await exists(resolve(deps.layout.binDirectory, "lervo"))).toBe(false);
  });

  it("refuses an install whose package bytes differ from the verified files", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home, {
      installer: async (input) => {
        await extractingInstaller(input);
        const root = await realpath(resolve(input.directory, "node_modules", "@lervo", "cli"));
        await writeFile(resolve(root, "dist", "node-runtime.js"), "export const changed = 1;\n");
      },
    });
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps),
    ).rejects.toMatchObject({
      code: "host_upgrade_installed_bytes_mismatch",
    });
    expect(await exists(resolve(deps.layout.binDirectory, "lervo"))).toBe(false);
    expect(await exists(deps.layout.installsDirectory)).toBe(true);
    expect(execFileSync("ls", ["-A", deps.layout.installsDirectory], { encoding: "utf8" })).toBe(
      "",
    );
  });

  it("refuses an install with anything but bin shims in the package-root node_modules", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home, {
      installer: async (input) => {
        await extractingInstaller(input);
        const root = await realpath(resolve(input.directory, "node_modules", "@lervo", "cli"));
        await mkdir(resolve(root, "node_modules", ".bin"), { recursive: true });
        await mkdir(resolve(root, "node_modules", "zod"), { recursive: true });
        await writeFile(resolve(root, "node_modules", "zod", "index.js"), "module.exports = 1;\n");
      },
    });
    const failure = await applyReleaseUpgrade(
      fakeReleaseSource([releaseFixture()]),
      "v9.9.9",
      deps,
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "host_upgrade_installed_bytes_mismatch",
      details: { paths: ["node_modules/zod"] },
    });
  });

  it("never replaces a user-owned executable file", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    await mkdir(deps.layout.binDirectory, { recursive: true });
    await writeFile(resolve(deps.layout.binDirectory, "lervo"), "#!/bin/sh\n");
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps),
    ).rejects.toMatchObject({
      code: "host_upgrade_link_not_managed",
    });
    expect(await readFile(resolve(deps.layout.binDirectory, "lervo"), "utf8")).toBe("#!/bin/sh\n");
  });

  it("refuses to run beside a live host upgrade and takes over a crashed one's lock", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    await mkdir(deps.layout.cliDirectory, { recursive: true });
    await writeFile(deps.layout.lockPath, `${process.pid}\n`);
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps),
    ).rejects.toMatchObject({
      code: "host_upgrade_in_progress",
    });
    await writeFile(deps.layout.lockPath, "999999999\n");
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps),
    ).resolves.toMatchObject({
      status: "activated",
    });
  });

  it("removes a staged download that fails verification and installs nothing", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const fixture = releaseFixture();
    fixture.assets.set("release-sbom.cdx.json", Buffer.from("{}\n"));
    await expect(
      applyReleaseUpgrade(fakeReleaseSource([fixture]), "v9.9.9", deps),
    ).rejects.toMatchObject({
      code: "release_subjects_digest_mismatch",
    });
    expect(await exists(deps.layout.installsDirectory)).toBe(false);
    expect(execFileSync("ls", ["-A", deps.layout.downloadsDirectory], { encoding: "utf8" })).toBe(
      "",
    );
  });

  it("prunes only unreferenced release directories it owns", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const stale = resolve(deps.layout.installsDirectory, `1.0.0-${"0".repeat(12)}`);
    const foreign = resolve(deps.layout.installsDirectory, "keep-me");
    await mkdir(stale, { recursive: true });
    await mkdir(foreign, { recursive: true });
    const result = await applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps);
    expect(result).toMatchObject({ status: "activated", pruned: [stale] });
    expect(await exists(foreign)).toBe(true);
  });
});

describe("rollbackActivation", () => {
  it("restores exactly the links an activation replaced and refuses once they moved again", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const previousTarget = resolve(home, "old", "bin.js");
    await mkdir(resolve(home, "old"), { recursive: true });
    await writeFile(previousTarget, '#!/usr/bin/env node\nconsole.log("lervo 9.9.8");\n');
    await chmod(previousTarget, 0o755);
    await mkdir(deps.layout.binDirectory, { recursive: true });
    await symlink(previousTarget, resolve(deps.layout.binDirectory, "lervo"));
    const releases = [
      releaseFixture(),
      releaseFixture({ version: "9.9.10", commit: "d".repeat(40) }),
    ];
    const source = fakeReleaseSource(releases);
    const first = await applyReleaseUpgrade(source, "v9.9.9", deps);
    if (first.status !== "activated") throw new Error("expected activation");
    const id = first.activation.activationId;

    const plan = await rollbackActivation(id, false, deps);
    expect(plan.status).toBe("ready");
    expect(await readlink(resolve(deps.layout.binDirectory, "lervo"))).not.toBe(previousTarget);

    const second = await applyReleaseUpgrade(source, "v9.9.10", deps);
    if (second.status !== "activated") throw new Error("expected activation");
    await expect(rollbackActivation(id, true, deps)).rejects.toMatchObject({
      code: "host_upgrade_rollback_superseded",
    });
    await rollbackActivation(second.activation.activationId, true, deps);
    const rolledBack = await rollbackActivation(id, true, deps);
    expect(rolledBack.status).toBe("rolled_back");
    expect(await readlink(resolve(deps.layout.binDirectory, "lervo"))).toBe(previousTarget);
    expect(await exists(resolve(deps.layout.binDirectory, "lervo-node"))).toBe(false);
    expect((await readActivationJournal(deps.layout)).map((record) => record.kind)).toEqual([
      "release",
      "release",
      "rollback",
      "rollback",
    ]);
  });

  it("undoes a first install by removing both links", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const first = await applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps);
    if (first.status !== "activated") throw new Error("expected activation");
    await expect(
      rollbackActivation(first.activation.activationId, true, deps),
    ).resolves.toMatchObject({
      status: "rolled_back",
      activation: { outcome: "active" },
    });
    expect(await exists(resolve(deps.layout.binDirectory, "lervo"))).toBe(false);
    expect(await exists(resolve(deps.layout.binDirectory, "lervo-node"))).toBe(false);
  });

  it("rolls back and reconciles an activation that crashed between its two link renames", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const source = fakeReleaseSource([releaseFixture()]);
    await applyReleaseUpgrade(source, "v9.9.9", deps);
    const before = await readHostLinks(deps.layout);
    const crashed = {
      activationId: `hact_${"c".repeat(24)}`,
      kind: "release" as const,
      outcome: "pending" as const,
      activatedAt: "2026-11-16T00:00:00.000Z",
      links: ["lervo", "lervo-node"].map((name) => ({
        name,
        path: resolve(deps.layout.binDirectory, name),
        previous: before.get(name) ?? null,
        current: resolve(home, "next", name),
      })),
    };
    await recordActivation(deps.layout, crashed);
    // The crash: lervo was renamed to the new target, lervo-node was not.
    await rm(resolve(deps.layout.binDirectory, "lervo"));
    await symlink(resolve(home, "next", "lervo"), resolve(deps.layout.binDirectory, "lervo"));

    const plan = await rollbackActivation(crashed.activationId, false, deps);
    expect(plan.links.map((link) => [link.name, link.current])).toEqual([
      ["lervo", before.get("lervo")],
    ]);

    const result = await applyReleaseUpgrade(source, "v9.9.9", deps);
    expect(result).toMatchObject({
      status: "current",
      reconciledActivations: [crashed.activationId],
    });
    expect(await readHostLinks(deps.layout)).toEqual(before);
    const settled = (await readActivationJournal(deps.layout)).find(
      (record) => record.activationId === crashed.activationId,
    );
    expect(settled?.outcome).toBe("restored");
    await expect(rollbackActivation(crashed.activationId, true, deps)).resolves.toMatchObject({
      status: "rolled_back",
      links: [],
    });
  });

  it("restores a crashed activation's links through its own rollback", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    await applyReleaseUpgrade(fakeReleaseSource([releaseFixture()]), "v9.9.9", deps);
    const before = await readHostLinks(deps.layout);
    const crashed = {
      activationId: `hact_${"d".repeat(24)}`,
      kind: "release" as const,
      outcome: "pending" as const,
      activatedAt: "2026-11-16T00:00:00.000Z",
      links: ["lervo", "lervo-node"].map((name) => ({
        name,
        path: resolve(deps.layout.binDirectory, name),
        previous: before.get(name) ?? null,
        current: resolve(home, "next", name),
      })),
    };
    await recordActivation(deps.layout, crashed);
    // The crash: both renames happened, then the health gate never ran.
    for (const name of ["lervo", "lervo-node"]) {
      await rm(resolve(deps.layout.binDirectory, name));
      await symlink(resolve(home, "next", name), resolve(deps.layout.binDirectory, name));
    }
    const result = await rollbackActivation(crashed.activationId, true, deps);
    expect(result.reconciledActivations).toEqual([crashed.activationId]);
    expect(await readHostLinks(deps.layout)).toEqual(before);
  });

  it("abandons a crash record whose links moved, so a later apply of the same targets stays", async () => {
    const home = await temporaryHome();
    const deps = dependencies(home);
    const releases = [
      releaseFixture({ version: "1.0.1", commit: "1".repeat(40) }),
      releaseFixture({ version: "1.0.2", commit: "2".repeat(40) }),
      releaseFixture({ version: "1.0.3", commit: "3".repeat(40) }),
    ];
    const source = fakeReleaseSource(releases);
    await applyReleaseUpgrade(source, "v1.0.1", deps);
    const v1 = await readHostLinks(deps.layout);
    await applyReleaseUpgrade(source, "v1.0.2", deps);
    const v2 = await readHostLinks(deps.layout);
    // A crash record for v1 -> v2, then the owner relinks both links to a third target.
    const crashed = {
      activationId: `hact_${"e".repeat(24)}`,
      kind: "release" as const,
      outcome: "pending" as const,
      activatedAt: "2026-11-16T00:00:00.000Z",
      links: ["lervo", "lervo-node"].map((name) => ({
        name,
        path: resolve(deps.layout.binDirectory, name),
        previous: v1.get(name) ?? null,
        current: v2.get(name) ?? null,
      })),
    };
    await recordActivation(deps.layout, crashed);
    const third = resolve(home, "third");
    await mkdir(third, { recursive: true });
    await writeFile(resolve(third, "lervo"), '#!/usr/bin/env node\nconsole.log("lervo 0.9.0");\n');
    await chmod(resolve(third, "lervo"), 0o755);
    await writeFile(resolve(third, "lervo-node"), "void 0;\n");
    for (const name of ["lervo", "lervo-node"]) {
      await rm(resolve(deps.layout.binDirectory, name));
      await symlink(resolve(third, name), resolve(deps.layout.binDirectory, name));
    }
    const thirdLinks = await readHostLinks(deps.layout);

    const again = await applyReleaseUpgrade(source, "v1.0.2", deps);
    if (again.status !== "activated") throw new Error("expected activation");
    expect(again.reconciledActivations).toEqual([crashed.activationId]);
    const outcome = async () =>
      (await readActivationJournal(deps.layout)).find(
        (record) => record.activationId === crashed.activationId,
      )?.outcome;
    expect(await outcome()).toBe("abandoned");
    expect(await readHostLinks(deps.layout)).toEqual(v2);

    // A different tag now records v2, not v1, as what it replaced.
    const next = await applyReleaseUpgrade(source, "v1.0.3", deps);
    if (next.status !== "activated") throw new Error("expected activation");
    expect(new Map(next.activation.links.map((link) => [link.name, link.previous]))).toEqual(v2);
    await rollbackActivation(next.activation.activationId, true, deps);
    expect(await readHostLinks(deps.layout)).toEqual(v2);

    // Rolling back the re-apply returns to the owner's third target, never to v1.
    await expect(
      rollbackActivation(again.activation.activationId, true, deps),
    ).resolves.toMatchObject({
      status: "rolled_back",
      reconciledActivations: [],
    });
    expect(await readHostLinks(deps.layout)).toEqual(thirdLinks);
    expect(await outcome()).toBe("abandoned");
    await expect(rollbackActivation(crashed.activationId, true, deps)).resolves.toMatchObject({
      links: [],
    });
    expect(await readHostLinks(deps.layout)).toEqual(thirdLinks);
  });

  it("names an unknown activation", async () => {
    const home = await temporaryHome();
    await expect(
      rollbackActivation(`hact_${"f".repeat(24)}`, true, dependencies(home)),
    ).rejects.toMatchObject({
      code: "host_upgrade_activation_unknown",
    });
  });
});

describe("findPathShadow", () => {
  it("names an earlier lervo on PATH and nothing when the managed link comes first", async () => {
    const home = await temporaryHome();
    const layout = hostUpgradeLayout({ homeDirectory: home, platform: "linux" });
    const other = resolve(home, "other-bin");
    await mkdir(other, { recursive: true });
    await writeFile(resolve(other, "lervo"), "#!/bin/sh\n");
    expect(await findPathShadow(layout, `${other}:${layout.binDirectory}`)).toBe(
      resolve(other, "lervo"),
    );
    expect(await findPathShadow(layout, `${layout.binDirectory}:${other}`)).toBeNull();
    expect(await findPathShadow(layout, undefined)).toBeNull();
  });
});

describe("host activation journal", () => {
  it("keeps only the newest records", async () => {
    const home = await temporaryHome();
    const layout = hostUpgradeLayout({ homeDirectory: home, platform: "linux" });
    for (let index = 0; index < 11; index += 1)
      await recordActivation(layout, {
        activationId: `hact_${String(index).padStart(24, "0")}`,
        kind: "rollback",
        outcome: "active",
        activatedAt: "2026-11-16T00:00:00.000Z",
        links: [],
      });
    const journal = await readActivationJournal(layout);
    expect(journal).toHaveLength(8);
    expect(journal[0]?.activationId).toBe(`hact_${"3".padStart(24, "0")}`);
  });

  it("reports a damaged journal with its code and leaves it untouched", async () => {
    const home = await temporaryHome();
    const layout = hostUpgradeLayout({ homeDirectory: home, platform: "linux" });
    await mkdir(layout.cliDirectory, { recursive: true });
    for (const contents of ["", "{", '{"schemaVersion":1,"activations":[{"activationId":1}]}']) {
      await writeFile(layout.journalPath, contents);
      await expect(readActivationJournal(layout)).rejects.toMatchObject({
        code: "host_upgrade_journal_invalid",
      });
      expect(await readFile(layout.journalPath, "utf8")).toBe(contents);
    }
  });
});

describe("lervo host upgrade", () => {
  it("plans, applies, and reports status through the command", async () => {
    const home = await temporaryHome();
    const output: string[] = [];
    const io = {
      cwd: home,
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => output.push(text),
    };
    const overrides = {
      createSource: () => fakeReleaseSource([releaseFixture()]),
      homeDirectory: home,
      platform: "linux" as const,
      installer: extractingInstaller,
      newActivationId: () => `hact_${"a".repeat(24)}`,
    };
    const base = ["upgrade", "--from-release", "v9.9.9", "--repository", "owner/lervo"];
    expect(await runHostCommand([...base, "--json"], io, overrides)).toBe(0);
    expect(JSON.parse(output.pop() as string)).toMatchObject({
      operation: "host_upgrade_plan",
      status: "ready",
    });
    expect(await runHostCommand([...base, "--apply"], io, overrides)).toBe(0);
    expect(output.pop()).toContain(`lervo host upgrade --rollback hact_${"a".repeat(24)} --apply`);
    expect(await runHostCommand(["upgrade", "--status", "--json"], io, overrides)).toBe(0);
    expect(JSON.parse(output.pop() as string).activations).toHaveLength(1);
    const lervoLink = resolve(home, ".local", "bin", "lervo");
    await rm(lervoLink);
    await writeFile(lervoLink, "#!/bin/sh\n");
    expect(await runHostCommand(["upgrade", "--status", "--json"], io, overrides)).toBe(0);
    expect(JSON.parse(output.pop() as string).links[0]).toMatchObject({ state: "unmanaged" });
  });

  it("rejects ambiguous or incomplete arguments with a stable code", async () => {
    const home = await temporaryHome();
    const output: string[] = [];
    const io = {
      cwd: home,
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => output.push(text),
    };
    for (const args of [
      ["upgrade", "--from-release", "v1.0.0", "--json"],
      ["upgrade", "--status", "--apply", "--json"],
      ["upgrade", "--status", "--rollback", `hact_${"a".repeat(24)}`, "--json"],
      ["upgrade", "--rollback", "nope", "--json"],
      ["upgrade", "--status", "--bin-directory", "relative/bin", "--json"],
    ]) {
      expect(await runHostCommand(args, io, { homeDirectory: home, platform: "linux" })).toBe(1);
      expect(JSON.parse(output.pop() as string).error.code).toBe("host_upgrade_arguments_invalid");
    }
    expect(
      await runHostCommand(["upgrade", "--status", "--json"], io, {
        homeDirectory: home,
        platform: "win32",
      }),
    ).toBe(1);
    expect(JSON.parse(output.pop() as string).error.code).toBe("host_upgrade_platform_unsupported");
  });
});

const pnpmAvailable = (() => {
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("pnpmInstaller", () => {
  it.skipIf(!pnpmAvailable)(
    "installs from one pinned registry with the closure pinned by overrides, in an isolated home",
    async () => {
      const home = await temporaryHome();
      // pnpm keeps its store, cache, and configuration under the XDG directories; point them at
      // the temporary home so the test never touches the host's own pnpm state.
      const isolatedEnvironment: [string, string][] = [
        ["HOME", home],
        ["XDG_DATA_HOME", resolve(home, "data")],
        ["XDG_CACHE_HOME", resolve(home, "cache")],
        ["XDG_CONFIG_HOME", resolve(home, "config")],
        ["XDG_STATE_HOME", resolve(home, "state")],
      ];
      for (const [name, path] of isolatedEnvironment) vi.stubEnv(name, path);
      // The caret range alone would resolve 1.1.0, the registry's latest; the manifest closure
      // names 1.0.0, so only working overrides let the closure check pass.
      const registry = await startFixtureRegistry("lervo-fixture-dep", ["1.0.0", "1.1.0"]);
      try {
        const deps = dependencies(home, { installer: createPnpmInstaller(registry.url) });
        const fixture = releaseFixture({
          dependencies: { "lervo-fixture-dep": "^1.0.0" },
          portable: ["lervo-fixture-dep@1.0.0"],
        });
        const result = await applyReleaseUpgrade(fakeReleaseSource([fixture]), "v9.9.9", deps);
        expect(result.status).toBe("activated");
        expect(
          execFileSync(resolve(deps.layout.binDirectory, "lervo"), ["--version"], {
            encoding: "utf8",
          }),
        ).toBe("lervo 9.9.9\n");
        const installDirectory = resolve(deps.layout.installsDirectory, `9.9.9-${"c".repeat(12)}`);
        expect(await readFile(resolve(installDirectory, ".npmrc"), "utf8")).toBe(
          `registry=${registry.url}\n`,
        );
      } finally {
        await registry.close();
      }
    },
    120_000,
  );

  it("names a pnpm that cannot start in the install log instead of leaving it empty", async () => {
    const home = await temporaryHome();
    const directory = resolve(home, "staging");
    await mkdir(directory, { recursive: true });
    const logPath = resolve(directory, "install.log");
    vi.stubEnv("PATH", resolve(home, "no-tools"));
    await expect(
      createPnpmInstaller("http://127.0.0.1:9/")({ directory, logPath }),
    ).rejects.toThrow();
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("lervo: pnpm install failed:");
    expect(log).toContain("ENOENT");
    expect(log).toContain(`PATH=${resolve(home, "no-tools")}`);
  });
});
