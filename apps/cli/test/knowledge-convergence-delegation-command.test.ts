import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "../../../packages/repository-knowledge-runtime/test/fixture.js";
import {
  assetManifest,
  reviewedManifestDelegation,
} from "../../../packages/repository-knowledge-runtime/test/asset-manifest.fixture.js";
import { runKnowledgeConvergenceDelegationCommand } from "../src/knowledge-convergence-delegation-command.js";

const ports = vi.hoisted(() => ({ open: vi.fn(), openReadOnly: vi.fn() }));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openProjectStorage: ports.open,
  openReadOnlyProjectStorage: ports.openReadOnly,
}));
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("previews the exact asset bytes, refuses a changed candidate, and applies the reviewed pair", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const close = vi.fn().mockResolvedValue(undefined);
  ports.open.mockResolvedValue({ ...f.storage, close });
  ports.openReadOnly.mockResolvedValue({ ...f.storage, close });
  const candidatePath = resolve(f.directory, "reviewed-assets.json");
  const grantCandidatePath = resolve(f.directory, "reviewed-delegation.json");
  const manifestBytes = Buffer.from(JSON.stringify(assetManifest()));
  await writeFile(candidatePath, manifestBytes);
  await writeFile(
    grantCandidatePath,
    JSON.stringify(reviewedManifestDelegation(f.delegation!, manifestBytes)),
  );
  const installedManifest = resolve(f.root, ".lervo/knowledge/convergence-asset-dispositions.json");
  const installedGrant = resolve(f.root, ".lervo/knowledge/convergence-delegation.json");
  const before = await readFile(installedGrant);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    cwd: f.root,
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  const args = ["--from", grantCandidatePath, "--asset-manifest-from", candidatePath, "--json"];
  expect(await runKnowledgeConvergenceDelegationCommand(args, io)).toBe(0);
  expect(ports.openReadOnly).toHaveBeenCalledOnce();
  expect(ports.open).not.toHaveBeenCalled();
  const plan = JSON.parse(stdout[0]!) as { status: string; planId: string };
  expect(plan.status).toBe("review_required");
  expect(await readFile(installedGrant)).toEqual(before);
  await expect(readFile(installedManifest)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(candidatePath, `${manifestBytes.toString()}\n`);
  expect(
    await runKnowledgeConvergenceDelegationCommand([...args, "--apply", plan.planId], io),
  ).toBe(1);
  expect(stdout).toHaveLength(1);
  expect(await readFile(installedGrant)).toEqual(before);
  await expect(readFile(installedManifest)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(candidatePath, manifestBytes);
  expect(
    await runKnowledgeConvergenceDelegationCommand([...args, "--apply", plan.planId], io),
  ).toBe(0);
  expect(JSON.parse(stdout[1]!)).toMatchObject({ status: "applied", planId: plan.planId });
  expect(await readFile(installedManifest)).toEqual(manifestBytes);
  expect(close).toHaveBeenCalledTimes(3);
  expect(stderr.join(" ")).toContain("knowledge_authority_unavailable");
});
