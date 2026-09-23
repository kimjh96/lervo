import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { withNodeSupervisionUpgradeFence } from "../lib/node-supervision-upgrade-fence.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function config(standing = false) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-upgrade-fence-"));
  roots.push(root);
  const path = resolve(root, "node.json");
  await writeFile(
    path,
    JSON.stringify({
      repositoryRoot: "repository",
      outcomeSupervision: {
        [standing ? "standing" : "binding"]: {
          supervisionId: "supervision.test",
          ownerAgentId: `agt_${"a".repeat(24)}`,
          workstreamId: `wks_${"b".repeat(24)}`,
          mandateHash: `sha256:${"c".repeat(64)}`,
        },
      },
    }),
    { mode: 0o600 },
  );
  return { root, path };
}

it.each([true, false])(
  "holds the exact supervision owner lease across upgrade (%s)",
  async (standing) => {
    const fixture = await config(standing);
    const lease = { token: "lease" };
    const sequence = [];
    const currentId = standing ? "supervision.test.s1" : "supervision.test";
    const nextId = standing ? "supervision.test.s2" : null;
    const result = await withNodeSupervisionUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: fixture.path,
        ...(standing
          ? {
              resolveStanding: async (_root, binding) => ({
                binding: { ...binding, supervisionId: currentId },
                index: 1,
                nextSupervisionId: nextId,
              }),
            }
          : {}),
        openLeases: async (root) => {
          expect(root).toBe(resolve(fixture.root, "repository"));
          return {
            acquire: (input) => {
              expect(input).toMatchObject({
                ownerAgentId: `agt_${"a".repeat(24)}`,
                durationMs: 300_000,
              });
              sequence.push(`acquired:${input.supervisionId}`);
              return { ...lease, supervisionId: input.supervisionId };
            },
            release: (value) => {
              sequence.push(`released:${value.supervisionId}`);
            },
            close: () => sequence.push("closed"),
          };
        },
      },
      async () => {
        sequence.push("upgrade");
        return "upgraded";
      },
    );
    expect(result).toBe("upgraded");
    expect(sequence).toEqual([
      ...(nextId === null ? [] : [`acquired:${nextId}`]),
      `acquired:${currentId}`,
      "upgrade",
      `released:${currentId}`,
      ...(nextId === null ? [] : [`released:${nextId}`]),
      "closed",
    ]);
  },
);

it("refuses a busy owner without touching the service", async () => {
  const fixture = await config();
  let touched = false;
  let closed = false;
  await expect(
    withNodeSupervisionUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: fixture.path,
        openLeases: async () => ({
          acquire: () => null,
          release: () => {
            throw new Error("No lease was acquired.");
          },
          close: () => {
            closed = true;
          },
        }),
      },
      async () => {
        touched = true;
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_supervision_busy" });
  expect(touched).toBe(false);
  expect(closed).toBe(true);
});

it("releases the next-successor fence when the current successor is busy", async () => {
  const fixture = await config(true);
  const released = [];
  let touched = false;
  await expect(
    withNodeSupervisionUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: fixture.path,
        resolveStanding: async (_root, binding) => ({
          binding: { ...binding, supervisionId: "supervision.test.s1" },
          index: 1,
          nextSupervisionId: "supervision.test.s2",
        }),
        openLeases: async () => ({
          acquire: ({ supervisionId }) =>
            supervisionId === "supervision.test.s1" ? null : { supervisionId },
          release: ({ supervisionId }) => released.push(supervisionId),
          close: () => undefined,
        }),
      },
      async () => {
        touched = true;
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_supervision_busy" });
  expect(touched).toBe(false);
  expect(released).toEqual(["supervision.test.s2"]);
});

it("rejects a standing successor change observed after locking", async () => {
  const fixture = await config(true);
  const released = [];
  let resolves = 0;
  let touched = false;
  await expect(
    withNodeSupervisionUpgradeFence(
      {
        runtime: "node",
        action: "upgrade",
        config: fixture.path,
        resolveStanding: async (_root, binding) => {
          resolves += 1;
          const index = resolves;
          return {
            binding: { ...binding, supervisionId: `supervision.test.s${index}` },
            index,
            nextSupervisionId: `supervision.test.s${index + 1}`,
          };
        },
        openLeases: async () => ({
          acquire: ({ supervisionId }) => ({ supervisionId }),
          release: ({ supervisionId }) => released.push(supervisionId),
          close: () => undefined,
        }),
      },
      async () => {
        touched = true;
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_supervision_busy" });
  expect(resolves).toBe(2);
  expect(touched).toBe(false);
  expect(released).toEqual(["supervision.test.s1", "supervision.test.s2"]);
});

it("uses the real cross-connection process lock and releases it after a failed upgrade", async () => {
  const { SQLiteSupervisionOwnerLeaseStore } =
    await import("../../../packages/agent-workforce/dist/index.js");
  const fixture = await config();
  const path = resolve(fixture.root, "leases.sqlite");
  const active = SQLiteSupervisionOwnerLeaseStore.open(path);
  const owner = active.acquire({
    supervisionId: "supervision.test",
    ownerAgentId: `agt_${"a".repeat(24)}`,
    nowMs: Date.now(),
    durationMs: 300_000,
  });
  if (owner === null) throw new Error("The fixture owner lease was not acquired.");
  const input = {
    runtime: "node",
    action: "upgrade",
    config: fixture.path,
    openLeases: async () => SQLiteSupervisionOwnerLeaseStore.open(path),
  };
  try {
    await expect(
      withNodeSupervisionUpgradeFence(input, async () => "unsafe"),
    ).rejects.toMatchObject({ code: "service_upgrade_supervision_busy" });
    active.release(owner);
    await expect(
      withNodeSupervisionUpgradeFence(input, async () => {
        throw new Error("replacement failed");
      }),
    ).rejects.toThrow("replacement failed");
    await expect(withNodeSupervisionUpgradeFence(input, async () => "safe")).resolves.toBe("safe");
  } finally {
    active.close();
  }
});

it("rejects malformed supervised config before any upgrade operation", async () => {
  const fixture = await config();
  await writeFile(
    fixture.path,
    JSON.stringify({ repositoryRoot: "repository", outcomeSupervision: {} }),
  );
  let touched = false;
  await expect(
    withNodeSupervisionUpgradeFence(
      { runtime: "node", action: "upgrade", config: fixture.path },
      async () => {
        touched = true;
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_fence_invalid" });
  expect(touched).toBe(false);
});
