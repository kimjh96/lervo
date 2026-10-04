import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import { assetManifest, reviewedManifestDelegation } from "./asset-manifest.fixture.js";
import { createConvergenceDelegationPlan } from "../src/delegation-plan.js";
import {
  CONVERGENCE_ASSET_DISPOSITIONS_PATH,
  resolveConvergenceAssetDispositions,
} from "../src/asset-disposition-manifest.js";
import { CONVERGENCE_DELEGATION_PATH, assertConvergenceDelegation } from "../src/delegation.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("rejects malformed, unsafe, duplicate, unpinned and over-bound declarations without writes", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const item = assetManifest(1).dispositions[0]!;
  const invalid: unknown[] = [
    { schemaVersion: 2, dispositions: [item] },
    { schemaVersion: 1, dispositions: [item], authority: true },
    { schemaVersion: 1, dispositions: [item, item] },
    ...["../escape", "/absolute", "assets/../escape", ".git/config", ".lervo/state/private"].map(
      (path) => ({ schemaVersion: 1, dispositions: [{ ...item, path }] }),
    ),
    { schemaVersion: 1, dispositions: [{ ...item, verificationSuiteId: "unreviewed.suite" }] },
    { schemaVersion: 1, dispositions: [{ ...item, contentHash: "unbound" }] },
    assetManifest(1025),
  ];
  const before = await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH));
  for (const manifest of invalid) {
    const bytes = Buffer.from(JSON.stringify(manifest));
    await expect(
      createConvergenceDelegationPlan(f.storage, reviewedManifestDelegation(f.delegation!, bytes), {
        reviewedManifestBytes: bytes,
      }),
    ).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  }
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(1024 * 1024 + 1, 32)]) {
    await expect(
      createConvergenceDelegationPlan(f.storage, reviewedManifestDelegation(f.delegation!, bytes), {
        reviewedManifestBytes: bytes,
      }),
    ).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  }
  expect(await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH))).toEqual(before);
  await expect(
    readFile(resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH)),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps inline limits, combined uniqueness and the total manifest ceiling", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const manifest = assetManifest(1024);
  const bytes = Buffer.from(JSON.stringify(manifest));
  const reviewed = reviewedManifestDelegation(f.delegation!, bytes);
  expect(resolveConvergenceAssetDispositions(f.root, reviewed, bytes)).toHaveLength(1024);
  expect(() =>
    resolveConvergenceAssetDispositions(
      f.root,
      { ...reviewed, assetDispositions: [manifest.dispositions[0]!] },
      bytes,
    ),
  ).toThrowError(expect.objectContaining({ code: "knowledge_authority_unavailable" }));
  expect(() =>
    resolveConvergenceAssetDispositions(
      f.root,
      {
        ...reviewed,
        assetDispositions: [{ ...manifest.dispositions[0]!, path: "assets/additional.bin" }],
      },
      bytes,
    ),
  ).toThrowError(expect.objectContaining({ code: "knowledge_authority_unavailable" }));
  const { review, ...body } = f.delegation!;
  const inline = { ...body, assetDispositions: assetManifest(257).dispositions };
  const { convergenceDelegationPlanHash } = await import("../src/delegation.js");
  await expect(
    createConvergenceDelegationPlan(f.storage, {
      ...inline,
      review: { ...review, planHash: convergenceDelegationPlanHash(inline) },
    }),
  ).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  expect(() => resolveConvergenceAssetDispositions(f.root, f.delegation!, bytes)).toThrowError(
    expect.objectContaining({ code: "knowledge_authority_unavailable" }),
  );
});

it("requires exact ordinary sidecar bytes at runtime and rejects a missing, changed or linked manifest", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const bytes = Buffer.from(JSON.stringify(assetManifest()));
  const reviewed = reviewedManifestDelegation(f.delegation!, bytes);
  const path = resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  await writeFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH), JSON.stringify(reviewed));
  const assert = () =>
    assertConvergenceDelegation({
      repositoryRoot: f.root,
      projectId: f.storage.manifest.projectId,
      expectedHash: sha256(JSON.stringify(reviewed)),
      provider: "claude",
    });
  await expect(assert()).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  await writeFile(path, bytes);
  await expect(assert()).resolves.toMatchObject({
    assetDispositionManifestHash: reviewed.assetDispositionManifestHash,
  });
  await writeFile(path, `${bytes.toString()}\n`);
  await expect(assert()).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  await rm(path);
  const external = resolve(f.directory, "asset-declarations.json");
  await writeFile(external, bytes);
  await symlink(external, path);
  await expect(assert()).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
});
