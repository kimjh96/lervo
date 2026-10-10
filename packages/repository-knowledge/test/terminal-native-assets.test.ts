import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  applyTerminalIntegrationPlan,
  createTerminalIntegrationPlan,
  inspectTerminalIntegration,
  verifyTerminalHookRuntimeArtifact,
  serializableTerminalIntegrationPlan,
  recoverKnowledgeMaterialization,
  type TerminalRuntimeAsset,
  type KnowledgeMaterializationCheckpoint,
  sha256,
} from "../src/index.js";

const roots: string[] = [],
  content = "#!/usr/bin/env node\nprocess.exit(0);\n";
const runtimePath = ".lervo/generated/terminal-hooks/runtime-v2.mjs";
function assets(value = 1): TerminalRuntimeAsset[] {
  const binary = Buffer.from([0, 255, 128, value, 0, 254]);
  return [
    { path: "native/file-sync-darwin.node", content: binary },
    {
      path: "native/file-sync.json",
      content: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          apiVersion: 1,
          napiVersion: 8,
          platform: "darwin",
          architectures: ["arm64", "x64"],
          sourceHash: `sha256:${"a".repeat(64)}`,
          contentHash: sha256(binary),
        }),
      ),
    },
  ];
}
async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-native-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_terminal_native",
      now: new Date("2026-10-10T00:00:00Z"),
    }),
  );
  return root;
}
async function install(root: string, runtimeAssets: TerminalRuntimeAsset[] = []) {
  const plan = await createTerminalIntegrationPlan(root, content, null, runtimeAssets);
  await applyTerminalIntegrationPlan({
    plan,
    runtimeContent: content,
    runtimeAssets,
    ...(plan.approvalHash === null
      ? {}
      : { approvedOperationId: plan.operationId, approvedHash: plan.approvalHash }),
    now: new Date(),
    recordApplied: () => undefined,
  });
  return plan;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("installs exact binary bytes, hides payloads in plans, and verifies the complete runtime", async () => {
  const root = await repository(),
    pair = assets();
  const plan = await install(root, pair);
  expect(JSON.stringify(serializableTerminalIntegrationPlan(plan))).not.toContain('"content":');
  for (const asset of pair)
    expect(await readFile(resolve(root, ".lervo/generated/terminal-hooks", asset.path))).toEqual(
      Buffer.from(asset.content),
    );
  expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  expect((await inspectTerminalIntegration(root)).status).toBe("current");
  expect((await createTerminalIntegrationPlan(root, content, null, pair)).status).toBe("current");
});
it("upgrades only generated files and binds native-only changes to the plan identity", async () => {
  const root = await repository();
  await install(root);
  const oldHooks = await readFile(resolve(root, ".codex/hooks.json"));
  const first = await install(root, assets());
  expect(first.status).toBe("ready");
  expect(first.approvalHash).toBeNull();
  const plan = await createTerminalIntegrationPlan(root, content, null, assets(2));
  expect(plan.runtime.afterHash).toBe(first.runtime.afterHash);
  expect(plan.planId).not.toBe(first.planId);
  await install(root, assets(3));
  await expect(
    applyTerminalIntegrationPlan({
      plan,
      runtimeContent: content,
      runtimeAssets: assets(2),
      now: new Date(),
      recordApplied: () => undefined,
    }),
  ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
  expect(await readFile(resolve(root, ".codex/hooks.json"))).toEqual(oldHooks);
});
it.each(["published:0", "published:1", "published:2"] as const)(
  "rolls back binary and manifest updates after %s",
  async (checkpoint) => {
    const root = await repository(),
      before = assets();
    await install(root, before);
    const next = assets(2),
      plan = await createTerminalIntegrationPlan(root, content, null, next);
    let recorded = false;
    await expect(
      applyTerminalIntegrationPlan({
        plan,
        runtimeContent: content,
        runtimeAssets: next,
        now: new Date(),
        recordApplied: () => {
          recorded = true;
        },
        failureInjector: (current) => {
          if (current === checkpoint) throw new Error("injected");
        },
      }),
    ).rejects.toThrow();
    expect(recorded).toBe(false);
    for (const asset of before)
      expect(await readFile(resolve(root, ".lervo/generated/terminal-hooks", asset.path))).toEqual(
        Buffer.from(asset.content),
      );
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  },
);
it.each([
  "original_moved:0",
  "published:1",
  "event_recorded",
] as KnowledgeMaterializationCheckpoint[])(
  "recovers binary transactions interrupted at %s",
  async (checkpoint) => {
    const root = await repository(),
      before = assets(),
      next = assets(2);
    await install(root, before);
    const plan = await createTerminalIntegrationPlan(root, content, null, next);
    let recorded = false;
    await expect(
      applyTerminalIntegrationPlan({
        plan,
        runtimeContent: content,
        runtimeAssets: next,
        now: new Date(),
        recordApplied: () => {
          recorded = true;
        },
        failureInjector: (current) => (current === checkpoint ? "interrupt" : undefined),
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    const result = await recoverKnowledgeMaterialization({
      repositoryRoot: root,
      eventRecorded: () => recorded,
    });
    expect(result.disposition).toBe(recorded ? "committed_cleanup" : "rolled_back");
    for (const asset of recorded ? next : before)
      expect(await readFile(resolve(root, ".lervo/generated/terminal-hooks", asset.path))).toEqual(
        Buffer.from(asset.content),
      );
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  },
);
it.each(["corruption", "missing", "directory-link", "file-link", "undeclared", "runtime-bom"])(
  "rejects %s before hook input can be processed",
  async (kind) => {
    const root = await repository();
    await install(root, assets());
    const directory = resolve(root, ".lervo/generated/terminal-hooks"),
      binary = resolve(directory, "native/file-sync-darwin.node");
    if (kind === "runtime-bom") await writeFile(resolve(root, runtimePath), "\uFEFF" + content);
    if (kind === "corruption") await writeFile(binary, Buffer.from([1, 2, 3]));
    if (kind === "missing") await rm(resolve(directory, "native/file-sync.json"));
    if (kind === "file-link") {
      const other = resolve(root, "asset");
      await writeFile(other, assets()[0]!.content);
      await rm(binary);
      await symlink(other, binary);
    }
    if (kind === "directory-link") {
      await rm(resolve(directory, "native"), { recursive: true });
      const other = resolve(root, "assets");
      await mkdir(other);
      await symlink(other, resolve(directory, "native"));
    }
    if (kind === "undeclared") {
      const path = resolve(directory, "runtime-v2.json"),
        manifest = JSON.parse(await readFile(path, "utf8"));
      delete manifest.assets;
      manifest.schemaVersion = 1;
      await writeFile(path, JSON.stringify(manifest));
    }
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(false);
    expect((await inspectTerminalIntegration(root)).status).toBe("blocked");
  },
);

function completeAssets(value = 1): TerminalRuntimeAsset[] {
  const cas = assets(value).map((asset) => ({
    ...asset,
    path: asset.path.replace("file-sync", "cas-io") as TerminalRuntimeAsset["path"],
  }));
  return [...cas, ...assets(value)];
}
it("upgrades schema 2 to the complete schema 3 set and refuses an undeclared downgrade", async () => {
  const root = await repository();
  await install(root, assets());
  const first = await install(root, completeAssets());
  expect(first.runtime.assets).toHaveLength(4);
  const manifest = JSON.parse(
    await readFile(resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.json"), "utf8"),
  );
  expect(manifest.schemaVersion).toBe(3);
  expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  const changed = completeAssets();
  changed[0]!.content = completeAssets(2)[0]!.content;
  changed[1]!.content = completeAssets(2)[1]!.content;
  const plan = await createTerminalIntegrationPlan(root, content, null, changed);
  expect(plan.runtime.afterHash).toBe(first.runtime.afterHash);
  expect(plan.planId).not.toBe(first.planId);
  expect(await createTerminalIntegrationPlan(root, content, null, assets())).toMatchObject({
    status: "blocked",
    operations: [],
    blockers: [{ code: "runtime_invalid" }],
  });
  expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
});
it.each(["published:0", "published:1", "published:2", "published:3", "published:4"] as const)(
  "restores all four assets and the outer manifest after %s",
  async (checkpoint) => {
    const root = await repository(),
      before = completeAssets();
    await install(root, before);
    const next = completeAssets(2),
      plan = await createTerminalIntegrationPlan(root, content, null, next);
    await expect(
      applyTerminalIntegrationPlan({
        plan,
        runtimeContent: content,
        runtimeAssets: next,
        now: new Date(),
        recordApplied: () => undefined,
        failureInjector: (current) => {
          if (current === checkpoint) throw Error("injected");
        },
      }),
    ).rejects.toThrow();
    for (const asset of before)
      expect(await readFile(resolve(root, ".lervo/generated/terminal-hooks", asset.path))).toEqual(
        Buffer.from(asset.content),
      );
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  },
);
it.each(["missing", "changed", "linked", "undeclared"])(
  "rejects a %s CAS asset before hook input",
  async (kind) => {
    const root = await repository();
    await install(root, completeAssets());
    const directory = resolve(root, ".lervo/generated/terminal-hooks"),
      binary = resolve(directory, "native/cas-io-darwin.node");
    if (kind === "missing") await rm(resolve(directory, "native/cas-io.json"));
    if (kind === "changed") await writeFile(binary, "changed");
    if (kind === "linked") {
      await rm(binary);
      await symlink(resolve(directory, "native/file-sync-darwin.node"), binary);
    }
    if (kind === "undeclared") {
      const path = resolve(directory, "runtime-v2.json"),
        manifest = JSON.parse(await readFile(path, "utf8"));
      manifest.schemaVersion = 2;
      manifest.assets = manifest.assets.filter((asset: { path: string }) =>
        asset.path.includes("file-sync"),
      );
      await writeFile(path, JSON.stringify(manifest));
    }
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(false);
  },
);

it.each(["published:3", "event_recorded"] as KnowledgeMaterializationCheckpoint[])(
  "recovers the complete four-file transaction interrupted at %s",
  async (checkpoint) => {
    const root = await repository(),
      before = completeAssets(),
      next = completeAssets(2);
    await install(root, before);
    const plan = await createTerminalIntegrationPlan(root, content, null, next);
    let recorded = false;
    await expect(
      applyTerminalIntegrationPlan({
        plan,
        runtimeContent: content,
        runtimeAssets: next,
        now: new Date(),
        recordApplied: () => {
          recorded = true;
        },
        failureInjector: (current) => (current === checkpoint ? "interrupt" : undefined),
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    await recoverKnowledgeMaterialization({ repositoryRoot: root, eventRecorded: () => recorded });
    for (const asset of recorded ? next : before)
      expect(await readFile(resolve(root, ".lervo/generated/terminal-hooks", asset.path))).toEqual(
        Buffer.from(asset.content),
      );
    expect(await verifyTerminalHookRuntimeArtifact(resolve(root, runtimePath))).toBe(true);
  },
);
