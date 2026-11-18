import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { holdEffect, readHeldEffects } from "../src/held-effect-debt.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("caps only Lervo's own held records and never evicts an owner hold (ADR-0561)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-held-effect-cap-"));
  roots.push(root);
  await holdEffect({
    repositoryRoot: root,
    effect: "upgrade_terminal_integration",
    subject: "lbk_owner_restore",
    reasonCode: "owner_restored",
  });
  for (let index = 0; index < 40; index += 1)
    await holdEffect({
      repositoryRoot: root,
      effect: "upgrade_knowledge",
      subject: `kplan_${index}`,
      reasonCode: "cross_check_unavailable",
    });
  const held = await readHeldEffects(root);
  expect(held.filter((item) => item.reasonCode === "owner_restored")).toEqual([
    expect.objectContaining({ subject: "lbk_owner_restore" }),
  ]);
  const automatic = held.filter((item) => item.reasonCode === "cross_check_unavailable");
  expect(automatic).toHaveLength(32);
  expect(automatic.at(0)?.subject).toBe("kplan_8");
  expect(automatic.at(-1)?.subject).toBe("kplan_39");
});
