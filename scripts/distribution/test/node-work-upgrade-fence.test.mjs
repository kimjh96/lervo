import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  SQLiteNodeWorkAdmission,
  nodeWorkAdmissionDatabasePath,
  nodeWorkAdmissionScope,
} from "../../../packages/node-work-admission/src/index.js";
import { withNodeWorkUpgradeFence } from "../lib/node-work-upgrade-fence.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-work-upgrade-"));
  roots.push(root);
  const config = resolve(root, "node.json");
  await writeFile(config, JSON.stringify({ repositoryRoot: root }), { mode: 0o600 });
  return { root, config };
}

it("refuses a live conversation before the service operation and releases no absent freeze", async () => {
  const value = await fixture();
  let touched = false;
  let closed = false;
  await expect(
    withNodeWorkUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: value.config,
        busyWaitMs: 0,
        openAdmission: async () => ({
          scope: "scope",
          store: {
            tryFreeze: () => ({ status: "busy", reason: "active_work" }),
            unfreeze: () => {
              throw new Error("No freeze exists.");
            },
            close: () => (closed = true),
          },
        }),
      },
      async () => {
        touched = true;
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_work_busy" });
  expect(touched).toBe(false);
  expect(closed).toBe(true);
});

it("waits for admitted work to drain and then runs the service operation", async () => {
  const value = await fixture();
  const steps = [];
  let attempts = 0;
  const freeze = { token: "freeze", scope: "scope", ownerPid: process.pid };
  await withNodeWorkUpgradeFence(
    {
      runtime: "node",
      action: "upgrade",
      config: value.config,
      busyWaitMs: 60_000,
      busyRetryMs: 1,
      sleep: async () => {
        steps.push("waited");
      },
      openAdmission: async () => ({
        scope: "scope",
        store: {
          tryFreeze: () => {
            attempts += 1;
            return attempts < 3
              ? { status: "busy", reason: "active_work" }
              : { status: "frozen", freeze };
          },
          unfreeze: () => steps.push("unfrozen"),
          close: () => steps.push("closed"),
        },
      }),
    },
    async () => {
      steps.push("operation");
    },
  );
  expect(steps).toEqual(["waited", "waited", "operation", "unfrozen", "closed"]);
});

it("holds the exact idle freeze through operation failure and then releases it", async () => {
  const value = await fixture();
  const steps = [];
  const freeze = { token: "freeze", scope: "scope", ownerPid: process.pid };
  await expect(
    withNodeWorkUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: value.config,
        openAdmission: async (_source, configPath) => {
          expect(configPath).toBe(value.config);
          return {
            scope: "scope",
            store: {
              tryFreeze: ({ configDigest }) => {
                expect(configDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
                steps.push("freeze");
                return { status: "frozen", freeze };
              },
              unfreeze: (selected) => {
                expect(selected).toBe(freeze);
                steps.push("unfreeze");
                return true;
              },
              close: () => steps.push("close"),
            },
          };
        },
      },
      async () => {
        steps.push("operation");
        throw new Error("replacement failed");
      },
    ),
  ).rejects.toThrow("replacement failed");
  expect(steps).toEqual(["freeze", "operation", "unfreeze", "close"]);
});

it("fails closed when the installed configuration changed since supervisor fencing", async () => {
  const value = await fixture();
  await expect(
    withNodeWorkUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: value.config,
        expectedSourceDigest: `sha256:${"f".repeat(64)}`,
        openAdmission: async () => {
          throw new Error("The admission store must not open.");
        },
      },
      async () => {
        throw new Error("The service must not be touched.");
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_fence_invalid" });
});

it("resolves a relative repository root from the exact configuration path", async () => {
  const value = await fixture();
  await writeFile(value.config, JSON.stringify({ repositoryRoot: "." }), { mode: 0o600 });
  await expect(
    withNodeWorkUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: value.config,
        openAdmission: async (source) => {
          expect(source.repositoryRoot).toBe(value.root);
          return {
            scope: "scope",
            store: {
              tryFreeze: () => ({
                status: "frozen",
                freeze: { token: "freeze", scope: "scope", ownerPid: process.pid },
              }),
              unfreeze: () => true,
              close: () => undefined,
            },
          };
        },
      },
      async () => "upgraded",
    ),
  ).resolves.toBe("upgraded");
});

it("refuses admitted work and excludes new work throughout an idle upgrade across SQLite connections", async () => {
  const value = await fixture();
  const path = nodeWorkAdmissionDatabasePath(value.root);
  const node = await SQLiteNodeWorkAdmission.open({ path });
  const scope = nodeWorkAdmissionScope(value.config);
  const source = await readFile(value.config, "utf8");
  const configDigest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const session = node.registerSession({ scope, configDigest });
  const claim = node.tryAcquireWork(session);
  if (claim === null) throw new Error("The Node did not admit the fixture work.");
  try {
    let operations = 0;
    const input = {
      runtime: "node",
      action: "upgrade",
      config: value.config,
      busyWaitMs: 0,
      openAdmission: async () => ({
        store: await SQLiteNodeWorkAdmission.open({ path }),
        scope,
      }),
    };
    await expect(
      withNodeWorkUpgradeFence(input, async () => {
        operations += 1;
      }),
    ).rejects.toMatchObject({ code: "service_upgrade_work_busy" });
    expect(operations).toBe(0);
    node.releaseWork(claim);
    await withNodeWorkUpgradeFence(input, async () => {
      operations += 1;
      expect(node.tryAcquireWork(session)).toBeNull();
    });
    expect(operations).toBe(1);
    const resumed = node.tryAcquireWork(session);
    expect(resumed).not.toBeNull();
    node.releaseWork(resumed);
  } finally {
    node.unregisterSession(session);
    node.close();
  }
});
