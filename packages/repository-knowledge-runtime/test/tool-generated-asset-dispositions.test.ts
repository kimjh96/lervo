import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { reboundConvergenceDelegation } from "../src/delegation-rebinding.js";
import {
  applyConvergenceDelegationPlan,
  createConvergenceDelegationPlan,
} from "../src/delegation-plan.js";
import { CONVERGENCE_ASSET_DISPOSITIONS_PATH } from "../src/asset-disposition-manifest.js";
import { loadConvergenceDelegation } from "../src/delegation.js";
import { toolGeneratedManifestCleanup } from "../src/tool-generated-asset-dispositions.js";
import {
  classifyConvergenceAssets,
  toolGeneratedOpaqueSources,
} from "../src/asset-verification.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { settledKnowledgeOutputPaths } from "../src/knowledge-output-commit.js";
import { reviewedManifestDelegation } from "./asset-manifest.fixture.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

const rationale =
  "This exact opaque asset is retained with its recorded byte hash under the pinned repository verification contract; it establishes no visual or runtime promotion.";

/** The installed shiflo shape: a manifest that pins the declared package manager's lockfile. */
async function pinnedLockfile() {
  const f = await fixture(true);
  fixtures.push(f);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", f.root, "-c", "user.name=Owner", "-c", "user.email=owner@example.com", ...args],
      { encoding: "utf8" },
    );
  await writeFile(
    resolve(f.root, "package.json"),
    JSON.stringify({ name: "shiflo", packageManager: "bun@1.3.3" }),
  );
  const lock = Buffer.from([0, 1, 2, 3]);
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9]);
  await writeFile(resolve(f.root, "bun.lock"), lock);
  await mkdir(resolve(f.root, "assets"), { recursive: true });
  await writeFile(resolve(f.root, "assets/icon.png"), icon);
  const manifest = {
    schemaVersion: 1,
    dispositions: [
      {
        path: "assets/icon.png",
        contentHash: sha256(icon),
        kind: "opaque_verified",
        verificationSuiteId: "knowledge.fixture",
        rationale,
      },
      {
        path: "bun.lock",
        contentHash: sha256(lock),
        kind: "opaque_verified",
        verificationSuiteId: "knowledge.fixture",
        rationale,
      },
    ],
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await applyConvergenceDelegationPlan(
    f.storage,
    await createConvergenceDelegationPlan(
      f.storage,
      reviewedManifestDelegation(f.delegation!, bytes),
      { reviewedManifestBytes: bytes },
    ),
  );
  git("add", "-A", "--", "package.json", "bun.lock", "assets", CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  git("commit", "--quiet", "-m", "pin assets");
  return { f, manifest, git };
}

it("drops a pinned package-manager lockfile from the asset manifest in the same-scope rebind", async () => {
  const { f, manifest } = await pinnedLockfile();
  const current = (await loadConvergenceDelegation(f.root))!.delegation;
  const rebound = await reboundConvergenceDelegation({ root: f.root, current, now: new Date() });
  expect(rebound).not.toBeNull();
  const kept = JSON.parse(new TextDecoder().decode(rebound!.reviewedManifestBytes)) as {
    dispositions: { path: string }[];
  };
  expect(kept.dispositions).toEqual([manifest.dispositions[0]]);
  expect(rebound!.delegation.assetDispositionManifestHash).toBe(
    sha256(rebound!.reviewedManifestBytes!),
  );
  // Every other scope coordinate is unchanged; the rebind keeps the reviewer and review time.
  expect(rebound!.delegation).toMatchObject({
    canonicalRoots: current.canonicalRoots,
    verification: current.verification,
    expiresAt: current.expiresAt,
    review: { reviewerAgentId: current.review.reviewerAgentId },
  });

  await applyConvergenceDelegationPlan(
    f.storage,
    await createConvergenceDelegationPlan(f.storage, rebound!.delegation, {
      reviewedManifestBytes: rebound!.reviewedManifestBytes!,
    }),
  );
  // The manifest edit is exactly the rebind's cleanup, so it settles as Lervo output.
  expect(
    await toolGeneratedManifestCleanup({
      root: f.root,
      committed: execFileSync("git", [
        "-C",
        f.root,
        "show",
        `HEAD:${CONVERGENCE_ASSET_DISPOSITIONS_PATH}`,
      ]),
      current: await readFile(resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH)),
    }),
  ).toBe(true);
  expect(
    await settledKnowledgeOutputPaths({
      repositoryRoot: f.root,
      events: f.events,
      artifacts: f.artifacts,
    }),
  ).toContain(CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  // A second rebind finds nothing more to drop.
  const after = (await loadConvergenceDelegation(f.root))!.delegation;
  expect(
    await reboundConvergenceDelegation({ root: f.root, current: after, now: new Date() }),
  ).toBe(null);
});

it("never settles a manifest edit that changes or removes a non-tool-generated declaration", async () => {
  const { f, manifest } = await pinnedLockfile();
  const edited = { ...manifest, dispositions: [manifest.dispositions[1]] };
  const committed = execFileSync("git", [
    "-C",
    f.root,
    "show",
    `HEAD:${CONVERGENCE_ASSET_DISPOSITIONS_PATH}`,
  ]);
  expect(
    await toolGeneratedManifestCleanup({
      root: f.root,
      committed,
      current: Buffer.from(JSON.stringify(edited)),
    }),
  ).toBe(false);
});

it("settles a tool-generated opaque file without a declaration and counts it separately", async () => {
  const { f } = await pinnedLockfile();
  await writeFile(resolve(f.root, "bun.lock"), Buffer.from([0, 9, 9, 9]));
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_tool_generated",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const toolGenerated = await toolGeneratedOpaqueSources(f.root, state);
  expect([...toolGenerated]).toEqual(["bun.lock"]);
  const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
  expect(classifyConvergenceAssets(f.root, state, delegation, toolGenerated)).toEqual({
    declared: 1,
    suiteBound: [],
    toolGenerated: 1,
  });
});
