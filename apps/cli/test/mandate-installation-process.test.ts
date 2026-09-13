import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";
import { installationFixture, supervisionId } from "./mandate-installation.fixture.js";

const executable = process.env.LERVO_INSTALLED_CLI;
const execute = promisify(execFile);
const roots: string[] = [];
const reviewer = "user.founder";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function invoke(root: string, args: string[]) {
  const result = await execute(executable!, [...args, "--root", root, "--json"], {
    cwd: root,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function authorityEvents(root: string) {
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    return storage.events
      .list({ limit: 100 })
      .filter((event) => event.type.startsWith("work.supervision.mandate."));
  } finally {
    await storage.close();
  }
}

describe.skipIf(executable === undefined)("installed mandate CLI process", () => {
  it("preserves one installation and revocation across independent process invocations", async () => {
    const f = await installationFixture(roots);
    const mandatePath = resolve(f.root, "mandate.json");
    const planPath = resolve(f.root, "reviewed-plan.json");
    await writeFile(mandatePath, JSON.stringify(f.mandate));
    const plan = await invoke(f.root, [
      "agent",
      "mandate",
      "plan",
      "--from",
      mandatePath,
      "--supervision",
      supervisionId,
      "--reviewer",
      reviewer,
    ]);
    expect(await authorityEvents(f.root)).toHaveLength(0);
    await writeFile(planPath, JSON.stringify(plan));
    const install = [
      "agent",
      "mandate",
      "install",
      "--from",
      planPath,
      "--approve",
      plan.approvalHash,
      "--reviewer",
      reviewer,
    ];
    await expect(invoke(f.root, install)).rejects.toThrow(/--write/u);
    await expect(
      invoke(f.root, [...install.slice(0, -1), "user.other", "--write"]),
    ).rejects.toThrow(/reviewer/u);
    expect(await authorityEvents(f.root)).toHaveLength(0);
    const installed = await invoke(f.root, [...install, "--write"]);
    expect(installed).toMatchObject({ mandate: f.mandate, revoked: false });
    expect(await invoke(f.root, [...install, "--write"])).toEqual(installed);
    expect(
      await invoke(f.root, ["agent", "mandate", "inspect", "--supervision", supervisionId]),
    ).toEqual(installed);
    expect(await authorityEvents(f.root)).toHaveLength(1);
    await invoke(f.root, [
      "agent",
      "status",
      "--agent",
      f.owner.agentId,
      "--status",
      "suspended",
      "--revision",
      "1",
      "--write",
    ]);
    const revoke = [
      "agent",
      "mandate",
      "revoke",
      "--supervision",
      supervisionId,
      "--workstream",
      plan.source.workstreamId,
      "--mandate-hash",
      plan.mandateHash,
      "--installation-event",
      installed.eventId,
      "--reviewer",
      reviewer,
      "--write",
    ];
    const revoked = await invoke(f.root, revoke);
    expect(revoked.revoked).toBe(true);
    expect(await invoke(f.root, revoke)).toEqual(revoked);
    await expect(invoke(f.root, [...install, "--write"])).rejects.toThrow();
    expect(await authorityEvents(f.root)).toHaveLength(2);
  }, 90_000);

  it("rejects widened scope and a reviewed plan whose canonical owner changed", async () => {
    const f = await installationFixture(roots);
    const mandatePath = resolve(f.root, "mandate.json");
    const planPath = resolve(f.root, "reviewed-plan.json");
    const planArgs = [
      "agent",
      "mandate",
      "plan",
      "--from",
      mandatePath,
      "--supervision",
      supervisionId,
      "--reviewer",
      reviewer,
    ];
    for (const change of [
      { pathRoots: ["private"] },
      { capabilityCeiling: ["deploy"] },
      { providers: ["claude"] },
      { teamIds: ["team_other001"] },
    ]) {
      await writeFile(mandatePath, JSON.stringify({ ...f.mandate, ...change }));
      await expect(invoke(f.root, planArgs)).rejects.toThrow();
    }
    await writeFile(mandatePath, JSON.stringify(f.mandate));
    const plan = await invoke(f.root, planArgs);
    await writeFile(planPath, JSON.stringify(plan));
    await invoke(f.root, [
      "agent",
      "rename",
      "--agent",
      f.owner.agentId,
      "--name",
      "Changed owner",
      "--revision",
      "1",
      "--write",
    ]);
    await expect(
      invoke(f.root, [
        "agent",
        "mandate",
        "install",
        "--from",
        planPath,
        "--approve",
        plan.approvalHash,
        "--reviewer",
        reviewer,
        "--write",
      ]),
    ).rejects.toThrow(/source changed/u);
    expect(await authorityEvents(f.root)).toHaveLength(0);
  }, 90_000);
});
