import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { changeAgentDisplayName, changeAgentStatus } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepositoryMandatePlan,
  inspectRepositoryMandate,
  installRepositoryMandate,
  revokeRepositoryMandate,
} from "../src/mandate-installation.js";
import { runAgentMandateCommand } from "../src/agent-mandate-command.js";
import { installationFixture, supervisionId } from "./mandate-installation.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const reviewerId = "user.founder";

describe("reviewed local mandate installation", () => {
  it("plans without installing, applies through the CLI, reopens exact artifacts and revokes idempotently", async () => {
    const f = await installationFixture(roots);
    const plan = await createRepositoryMandatePlan({ ...f, supervisionId, reviewerId });
    expect(await inspectRepositoryMandate({ root: f.root, supervisionId })).toBeNull();
    const path = resolve(f.root, "plan.json");
    await writeFile(path, JSON.stringify(plan));
    const output: string[] = [];
    const io = {
      cwd: f.root,
      stdout: (text: string) => output.push(text),
      stderr: () => undefined,
    };
    await expect(
      runAgentMandateCommand(
        ["install", "--from", path, "--approve", plan.approvalHash, "--reviewer", reviewerId],
        io,
      ),
    ).rejects.toThrow("--write");
    await expect(
      runAgentMandateCommand(
        [
          "install",
          "--from",
          path,
          "--approve",
          plan.approvalHash,
          "--reviewer",
          reviewerId,
          "--write",
        ],
        io,
      ),
    ).resolves.toBe(0);
    const installed = JSON.parse(output.join(""));
    expect(installed).toMatchObject({
      mandate: f.mandate,
      mandateHash: plan.mandateHash,
      revoked: false,
    });
    expect(await inspectRepositoryMandate({ root: f.root, supervisionId })).toEqual(installed);
    expect(
      await installRepositoryMandate({
        root: f.root,
        plan,
        approval: plan.approvalHash,
        reviewerId,
      }),
    ).toEqual(installed);
    await changeAgentStatus({
      repositoryRoot: f.root,
      agentId: f.owner.agentId,
      expectedRevision: 1,
      status: "suspended",
    });
    const revoke = {
      root: f.root,
      supervisionId,
      workstreamId: plan.source.workstreamId,
      mandateHash: plan.mandateHash,
      installationEventId: installed.eventId,
      reviewerId,
    };
    await expect(revokeRepositoryMandate({ ...revoke, reviewerId: "user.other" })).rejects.toThrow(
      "authority",
    );
    const revoked = await revokeRepositoryMandate(revoke);
    expect(revoked.revoked).toBe(true);
    expect(await revokeRepositoryMandate(revoke)).toEqual(revoked);
    const storage = await openProjectStorage(f.root);
    try {
      expect(storage.events.verifyIntegrity().valid).toBe(true);
    } finally {
      await storage.close();
    }
  });

  it("rejects changed canonical agent state, unsupported scope and forged approval", async () => {
    const f = await installationFixture(roots);
    const plan = await createRepositoryMandatePlan({ ...f, supervisionId, reviewerId });
    await expect(
      installRepositoryMandate({
        root: f.root,
        plan,
        approval: plan.approvalHash,
        reviewerId: "user.other",
      }),
    ).rejects.toThrow("reviewer");
    for (const change of [
      { pathRoots: ["private"] },
      { capabilityCeiling: ["deploy"] },
      { providers: ["claude"] },
      { teamIds: ["team_other001"] },
    ])
      await expect(
        createRepositoryMandatePlan({
          ...f,
          mandate: { ...f.mandate, ...change },
          supervisionId,
          reviewerId,
        }),
      ).rejects.toThrow();
    await changeAgentDisplayName({
      repositoryRoot: f.root,
      agentId: f.owner.agentId,
      expectedRevision: 1,
      displayName: "Changed owner",
    });
    await expect(
      installRepositoryMandate({ root: f.root, plan, approval: plan.approvalHash, reviewerId }),
    ).rejects.toThrow("source changed");
    expect(await inspectRepositoryMandate({ root: f.root, supervisionId })).toBeNull();
  });

  it("requires a later same-authority successor and rejects stale predecessor replay", async () => {
    const f = await installationFixture(roots);
    const first = await createRepositoryMandatePlan({ ...f, supervisionId, reviewerId });
    await installRepositoryMandate({
      root: f.root,
      plan: first,
      approval: first.approvalHash,
      reviewerId,
    });
    await expect(createRepositoryMandatePlan({ ...f, supervisionId, reviewerId })).rejects.toThrow(
      "later version",
    );
    const second = await createRepositoryMandatePlan({
      ...f,
      mandate: { ...f.mandate, version: 2 },
      supervisionId,
      reviewerId,
    });
    await installRepositoryMandate({
      root: f.root,
      plan: second,
      approval: second.approvalHash,
      reviewerId,
    });
    await expect(
      installRepositoryMandate({
        root: f.root,
        plan: first,
        approval: first.approvalHash,
        reviewerId,
      }),
    ).rejects.toThrow("predecessor");
    const manifest = resolve(f.root, ".lervo/project.yaml");
    await writeFile(
      manifest,
      (await readFile(manifest, "utf8")).replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
    );
    await expect(
      createRepositoryMandatePlan({
        ...f,
        mandate: { ...f.mandate, version: 3 },
        supervisionId,
        reviewerId,
      }),
    ).rejects.toThrow("designated execution host");
  });
});
