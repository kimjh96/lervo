import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import { assetManifest, reviewedManifestDelegation } from "./asset-manifest.fixture.js";
import {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
} from "../src/delegation-plan.js";
import { CONVERGENCE_DELEGATION_PATH } from "../src/delegation.js";
import { CONVERGENCE_ASSET_DISPOSITIONS_PATH } from "../src/asset-disposition-manifest.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { classifyConvergenceAssets } from "../src/asset-verification.js";
import { loadConvergenceDelegation } from "../src/delegation.js";
import {
  captureConvergenceSettlementAuthority,
  assertConvergenceSettlementAuthority,
} from "../src/settlement-fence.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("atomically applies all 277 asset declarations without expanding the grant, and still stops source drift", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const manifest = assetManifest();
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const reviewed = reviewedManifestDelegation(f.delegation!, bytes);
  const manifestPath = resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  const grantPath = resolve(f.root, CONVERGENCE_DELEGATION_PATH);
  const before = await readFile(grantPath);
  const plan = await createConvergenceDelegationPlan(f.storage, reviewed, {
    reviewedManifestBytes: bytes,
  });
  expect(await readFile(grantPath)).toEqual(before);
  await expect(readFile(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  await applyConvergenceDelegationPlan(f.storage, plan);
  expect(await readFile(manifestPath)).toEqual(bytes);
  expect((await readFile(grantPath)).byteLength).toBeLessThan(64 * 1024);
  const effects = f.events
    .list({ limit: 100 })
    .filter((event) => event.type === "knowledge.materialization.applied");
  expect(effects).toHaveLength(1);
  expect(effects[0]!.payload).toMatchObject({ createdCount: 1, updatedCount: 1 });
  expect(JSON.stringify(effects)).not.toContain("assets/model-");
  await mkdir(resolve(f.root, "assets"));
  await Promise.all(
    manifest.dispositions.map((item, index) =>
      writeFile(resolve(f.root, item.path), Buffer.from([0, index % 256])),
    ),
  );
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(baseline.sources.filter((source) => source.kind === "opaque")).toHaveLength(277);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_manifest",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource() {},
  };
  const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
  expect(classifyConvergenceAssets(f.root, state, delegation)).toEqual({
    declared: 277,
    suiteBound: [],
  });
  // ADR-0479: a declaration for earlier bytes no longer declares the asset; the suite binds it.
  state.baseline.sources.find((source) => source.path === "assets/model-276.bin")!.contentHash =
    `sha256:${"0".repeat(64)}`;
  expect(classifyConvergenceAssets(f.root, state, delegation)).toEqual({
    declared: 276,
    suiteBound: [{ path: "assets/model-276.bin", contentHash: `sha256:${"0".repeat(64)}` }],
  });
  state.receipts = [
    {
      stage: "assessment",
      artifactHash: `sha256:${"1".repeat(64)}`,
      snapshotHash: state.snapshotHash,
    },
  ];
  await captureConvergenceSettlementAuthority(context, state);
  expect(() => assertConvergenceSettlementAuthority(context, state)).not.toThrow();
  await writeFile(manifestPath, `${bytes.toString()} `);
  expect(() => assertConvergenceSettlementAuthority(context, state)).toThrowError(
    expect.objectContaining({ code: "knowledge_authority_unavailable" }),
  );
});

it("refuses a concurrently replaced manifest before changing either authority file", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const path = resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  const original = Buffer.from(JSON.stringify(assetManifest(1)));
  await writeFile(path, original);
  const desired = Buffer.from(JSON.stringify(assetManifest(277)));
  const plan = await createConvergenceDelegationPlan(
    f.storage,
    reviewedManifestDelegation(f.delegation!, desired),
    { reviewedManifestBytes: desired },
  );
  const grantBefore = await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH));
  const changed = Buffer.from(`${original.toString()}\n`);
  await writeFile(path, changed);
  await expect(applyConvergenceDelegationPlan(f.storage, plan)).rejects.toMatchObject({
    code: "knowledge_plan_stale",
  });
  expect(await readFile(path)).toEqual(changed);
  expect(await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH))).toEqual(grantBefore);
});

it("rolls back both files when the canonical materialization event fails", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const original = Buffer.from(JSON.stringify(assetManifest(1)));
  const path = resolve(f.root, CONVERGENCE_ASSET_DISPOSITIONS_PATH);
  await writeFile(path, original);
  const grantBefore = await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH));
  const desired = Buffer.from(JSON.stringify(assetManifest()));
  const plan = await createConvergenceDelegationPlan(
    f.storage,
    reviewedManifestDelegation(f.delegation!, desired),
    { reviewedManifestBytes: desired },
  );
  const append = f.events.append.bind(f.events);
  vi.spyOn(f.events, "append").mockImplementation((event) => {
    if (event.type === "knowledge.materialization.applied")
      throw new Error("Injected canonical append failure");
    return append(event);
  });
  await expect(applyConvergenceDelegationPlan(f.storage, plan)).rejects.toThrow(
    "rolled back to the original state",
  );
  expect(await readFile(path)).toEqual(original);
  expect(await readFile(resolve(f.root, CONVERGENCE_DELEGATION_PATH))).toEqual(grantBefore);
  expect(
    f.events
      .list({ limit: 100 })
      .filter((event) => event.type === "knowledge.materialization.applied"),
  ).toHaveLength(0);
});

it("settles unread sensitive sources by their baseline disposition and binds undeclared opaque bytes to the suite", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await mkdir(resolve(f.root, "src"), { recursive: true });
  await writeFile(
    resolve(f.root, "src/credentials.ts"),
    "export const credentialSource = 'env';\n",
  );
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(baseline.sourceDispositions).toContainEqual(
    expect.objectContaining({ path: "src/credentials.ts", kind: "sensitive_local" }),
  );
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_sensitive",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const delegation = (await loadConvergenceDelegation(f.root))!.delegation;
  expect(classifyConvergenceAssets(f.root, state, delegation)).toEqual({
    declared: 0,
    suiteBound: [],
  });

  await writeFile(resolve(f.root, "src/model.bin"), Buffer.from([0, 1, 2]));
  const withAsset = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(classifyConvergenceAssets(f.root, { ...state, baseline: withAsset }, delegation)).toEqual({
    declared: 0,
    suiteBound: [
      {
        path: "src/model.bin",
        contentHash: withAsset.sources.find((source) => source.path === "src/model.bin")!
          .contentHash,
      },
    ],
  });
});
