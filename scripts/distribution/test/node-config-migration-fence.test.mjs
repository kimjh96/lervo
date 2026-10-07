import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  SQLiteNodeWorkAdmission,
  nodeWorkAdmissionDatabasePath,
  nodeWorkAdmissionScope,
} from "../../../packages/node-work-admission/src/index.js";
import {
  createMigratedConfigurationRecovery,
  createNodeCliConfigurationTransition,
} from "../lib/node-cli-configuration-transition.mjs";
import {
  executablePathRewrites,
  findMigratedConfigPredecessors,
} from "../lib/node-executable-path-rewrites.mjs";
import { withNodeWorkUpgradeFence } from "../lib/node-work-upgrade-fence.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The WSL incident shape: supervision and an argument list pin a removed CLI install. */
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-config-migration-fence-"));
  roots.push(root);
  const install = resolve(root, "installs", "cli-0.21.0");
  await mkdir(resolve(install, "dist"), { recursive: true });
  await writeFile(resolve(install, "dist", "bin.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  const pointer = resolve(root, "share", "lervo", "runtimes", "cli", "current");
  await mkdir(resolve(pointer, ".."), { recursive: true });
  await symlink(install, pointer);
  const removed = resolve(root, "lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js");
  const before = {
    repositoryRoot: root,
    outcomeSupervision: {
      owner: "preserved",
      managedExecution: { nodeExecutable: "/usr/bin/node", cliBundle: removed },
    },
    requestedRuntimes: [{ executable: "/usr/bin/node", arguments: [removed, "knowledge"] }],
  };
  const after = structuredClone(before);
  after.outcomeSupervision.managedExecution.cliBundle = `${pointer}/dist/bin.js`;
  after.requestedRuntimes[0].arguments[0] = `${pointer}/dist/bin.js`;
  const config = resolve(root, "node.json");
  const original = `${JSON.stringify(before, null, 2)}\n`;
  const migrated = `${JSON.stringify(after, null, 2)}\n`;
  await writeFile(config, original, { mode: 0o600 });
  const path = nodeWorkAdmissionDatabasePath(root);
  const scope = nodeWorkAdmissionScope(config);
  return { root, config, original, migrated, before, after, path, scope };
}

/** What the ADR-0488 CLI did: back up, then rewrite the file while the Node kept running. */
async function migrateInPlace(f) {
  const backup = `${f.config}.pre-adr-0488-${digest(f.original).slice(7, 19)}`;
  await writeFile(backup, f.original, { mode: 0o600 });
  await writeFile(f.config, f.migrated, { mode: 0o600 });
}

function fenceInput(f, resolveConfigPredecessors) {
  return {
    runtime: "node",
    action: "upgrade",
    config: f.config,
    busyWaitMs: 0,
    openAdmission: async () => ({
      store: await SQLiteNodeWorkAdmission.open({ path: f.path }),
      scope: f.scope,
    }),
    ...(resolveConfigPredecessors === undefined ? {} : { resolveConfigPredecessors }),
  };
}

it("recognizes only executable-path moves through a host pointer", async () => {
  const f = await fixture();
  expect(executablePathRewrites(f.before, f.after)).toHaveLength(2);
  expect(executablePathRewrites(f.before, f.before)).toBeNull();
  const unrelated = structuredClone(f.after);
  unrelated.outcomeSupervision.owner = "changed";
  expect(executablePathRewrites(f.before, unrelated)).toBeNull();
  const elsewhere = structuredClone(f.before);
  elsewhere.outcomeSupervision.managedExecution.cliBundle = "/opt/lervo/dist/bin.js";
  expect(executablePathRewrites(f.before, elsewhere)).toBeNull();
});

it("names a configuration digest mismatch instead of a generic fence failure", async () => {
  const f = await fixture();
  const node = await SQLiteNodeWorkAdmission.open({ path: f.path });
  node.registerSession({ scope: f.scope, configDigest: digest(f.original) });
  await migrateInPlace(f);
  let touched = false;
  try {
    // Without a predecessor resolver this is exactly the deployed failure, now named.
    await expect(
      withNodeWorkUpgradeFence(fenceInput(f), async () => {
        touched = true;
      }),
    ).rejects.toMatchObject({
      code: "service_upgrade_config_mismatch",
      message: expect.stringContaining("different configuration digest"),
    });
    expect(touched).toBe(false);
  } finally {
    node.close();
  }
});

it("upgrades a Node whose configuration was migrated in place while it kept running", async () => {
  const f = await fixture();
  const node = await SQLiteNodeWorkAdmission.open({ path: f.path });
  const running = node.registerSession({ scope: f.scope, configDigest: digest(f.original) });
  await migrateInPlace(f);
  try {
    await withNodeWorkUpgradeFence(
      fenceInput(f, (source) => findMigratedConfigPredecessors(f.config, source.config)),
      async (admission) => {
        expect(admission.configPredecessor.configDigest).toBe(digest(f.original));
        const recovery = createMigratedConfigurationRecovery(
          { config: f.config },
          admission,
          admission.configPredecessor,
        );
        // The service manager stops the old Node before it applies the transition.
        node.unregisterSession(running);
        await recovery.apply();
        // The replacement Node starts from the migrated file and joins the frozen scope.
        const replacement = node.registerSession({
          scope: f.scope,
          configDigest: digest(f.migrated),
        });
        expect(node.tryAcquireWork(replacement)).toBeNull();
        await recovery.complete();
      },
    );
    expect(await readFile(f.config, "utf8")).toBe(f.migrated);
  } finally {
    node.close();
  }
});

it("restores the predecessor bytes and binding when the replacement fails", async () => {
  const f = await fixture();
  const node = await SQLiteNodeWorkAdmission.open({ path: f.path });
  const running = node.registerSession({ scope: f.scope, configDigest: digest(f.original) });
  await migrateInPlace(f);
  try {
    await withNodeWorkUpgradeFence(
      fenceInput(f, (source) => findMigratedConfigPredecessors(f.config, source.config)),
      async (admission) => {
        const recovery = createMigratedConfigurationRecovery(
          { config: f.config },
          admission,
          admission.configPredecessor,
        );
        node.unregisterSession(running);
        await recovery.apply();
        await recovery.restore();
      },
    );
    expect(await readFile(f.config, "utf8")).toBe(f.original);
    // The restored predecessor Node registers its original digest again.
    node.registerSession({ scope: f.scope, configDigest: digest(f.original) });
  } finally {
    node.close();
  }
});

it("ignores a backup whose name does not bind its bytes", async () => {
  const f = await fixture();
  await writeFile(`${f.config}.pre-adr-0488-${"0".repeat(12)}`, f.original, { mode: 0o600 });
  await writeFile(f.config, f.migrated, { mode: 0o600 });
  await expect(findMigratedConfigPredecessors(f.config, f.after)).resolves.toEqual([]);
});

it("applies an ADR-0488 migration through the guarded configuration transition", async () => {
  const f = await fixture();
  const configurationSource = resolve(f.root, "candidate.json");
  await writeFile(configurationSource, f.migrated, { mode: 0o600 });
  let current = digest(f.original);
  const transition = await createNodeCliConfigurationTransition(
    { config: f.config, configurationSource },
    {
      replaceConfiguration: (expected, desired) => {
        if (expected !== current) return false;
        current = desired;
        return true;
      },
    },
  );
  expect(await readFile(f.config, "utf8")).toBe(f.original);
  await transition.apply();
  expect(await readFile(f.config, "utf8")).toBe(f.migrated);
  expect(current).toBe(digest(f.migrated));
  await transition.restore();
  expect(await readFile(f.config, "utf8")).toBe(f.original);
  expect(current).toBe(digest(f.original));
});
