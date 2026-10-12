import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { SQLiteNodeWorkAdmission, nodeWorkAdmissionScope } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-work-admission-"));
  roots.push(root);
  const path = resolve(root, "admission.sqlite");
  const scope = nodeWorkAdmissionScope(resolve(root, "node.json"));
  const configDigest = `sha256:${"a".repeat(64)}`;
  const live = new Set([1001, 2001, 3001]);
  const first = await SQLiteNodeWorkAdmission.open({
    path,
    observeProcess: (pid) =>
      live.has(pid)
        ? {
            status: "present",
            identity: `proc_linux_ticks_v1:sha256:${String(pid).padStart(64, "0")}`,
          }
        : { status: "absent" },
  });
  const second = await SQLiteNodeWorkAdmission.open({
    path,
    observeProcess: (pid) =>
      live.has(pid)
        ? {
            status: "present",
            identity: `proc_linux_ticks_v1:sha256:${String(pid).padStart(64, "0")}`,
          }
        : { status: "absent" },
  });
  return { first, second, scope, configDigest, live };
}

it("serializes work admission and upgrade freeze across database connections", async () => {
  const { first, second, scope, configDigest } = await fixture();
  try {
    const session = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    const claim = first.tryAcquireWork(session);
    expect(claim).not.toBeNull();
    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "active_work",
    });
    first.releaseWork(claim!);

    const frozen = second.tryFreeze({ scope, configDigest, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw new Error("The idle Node was not frozen.");
    expect(first.tryAcquireWork(session)).toBeNull();
    expect(first.tryFreeze({ scope, configDigest, ownerPid: 3001 })).toEqual({
      status: "busy",
      reason: "upgrade_owned",
    });
    expect(second.unfreeze({ ...frozen.freeze, token: "wrong" })).toBe(false);
    expect(second.unfreeze(frozen.freeze)).toBe(true);
    const resumed = first.tryAcquireWork(session);
    expect(resumed).not.toBeNull();
    first.releaseWork(resumed!);
    first.unregisterSession(session);
  } finally {
    first.close();
    second.close();
  }
});

it("fails closed without an exact live session or matching configuration", async () => {
  const { first, second, scope, configDigest } = await fixture();
  try {
    expect(first.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "session_missing",
    });
    const session = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    expect(
      second.tryFreeze({ scope, configDigest: `sha256:${"b".repeat(64)}`, ownerPid: 2001 }),
    ).toEqual({ status: "busy", reason: "config_mismatch" });
    expect(() => second.registerSession({ scope, configDigest, ownerPid: 3001 })).toThrow(
      "already owns",
    );
    first.unregisterSession(session);
  } finally {
    first.close();
    second.close();
  }
});

it("freezes a previously registered stopped Node only with exact inactive authority", async () => {
  const { first, second, scope, configDigest, live } = await fixture();
  try {
    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001, allowNoSession: true })).toEqual(
      {
        status: "busy",
        reason: "session_missing",
      },
    );
    first.registerSession({ scope, configDigest, ownerPid: 1001 });
    live.delete(1001);
    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "session_missing",
    });
    expect(
      second.tryFreeze({
        scope,
        configDigest: `sha256:${"b".repeat(64)}`,
        ownerPid: 2001,
        allowNoSession: true,
      }),
    ).toEqual({ status: "busy", reason: "config_mismatch" });
    const frozen = second.tryFreeze({
      scope,
      configDigest,
      ownerPid: 2001,
      allowNoSession: true,
    });
    if (frozen.status !== "frozen") throw new Error("The stopped Node was not frozen.");
    const replacement = first.registerSession({ scope, configDigest, ownerPid: 3001 });
    expect(first.tryAcquireWork(replacement)).toBeNull();
    expect(second.unfreeze(frozen.freeze)).toBe(true);
    first.unregisterSession(replacement);
  } finally {
    first.close();
    second.close();
  }
});

it("keeps a gracefully stopped Node eligible for exact inactive recovery", async () => {
  const { first, second, scope, configDigest } = await fixture();
  try {
    const session = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    const frozen = second.tryFreeze({ scope, configDigest, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw new Error("The idle Node was not frozen.");
    expect(second.unfreeze(frozen.freeze)).toBe(true);
    // An interrupted upgrade can release its freeze before the old process finishes stopping.
    first.unregisterSession(session);

    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "session_missing",
    });
    expect(
      second.tryFreeze({
        scope,
        configDigest: `sha256:${"b".repeat(64)}`,
        ownerPid: 2001,
        allowNoSession: true,
      }),
    ).toEqual({ status: "busy", reason: "config_mismatch" });
    const recovered = second.tryFreeze({
      scope,
      configDigest,
      ownerPid: 2001,
      allowNoSession: true,
    });
    if (recovered.status !== "frozen") throw new Error("The stopped Node was not recoverable.");
    const replacement = first.registerSession({ scope, configDigest, ownerPid: 3001 });
    expect(first.tryAcquireWork(replacement)).toBeNull();
    expect(second.unfreeze(recovered.freeze)).toBe(true);
    first.unregisterSession(replacement);
  } finally {
    first.close();
    second.close();
  }
});

it("recovers only dead owners and never discards a live work claim", async () => {
  const { first, second, scope, configDigest, live } = await fixture();
  try {
    const session = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    expect(first.tryAcquireWork(session)).not.toBeNull();
    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "active_work",
    });
    live.delete(1001);
    expect(second.tryFreeze({ scope, configDigest, ownerPid: 2001 })).toEqual({
      status: "busy",
      reason: "session_missing",
    });
    const replacement = second.registerSession({ scope, configDigest, ownerPid: 3001 });
    const frozen = first.tryFreeze({ scope, configDigest, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw new Error("The replacement Node was not frozen.");
    live.delete(2001);
    expect(second.tryAcquireWork(replacement)).not.toBeNull();
  } finally {
    first.close();
    second.close();
  }
});

it("allows a replacement session under a freeze but blocks its work until release", async () => {
  const { first, second, scope, configDigest, live } = await fixture();
  try {
    first.registerSession({ scope, configDigest, ownerPid: 1001 });
    const frozen = second.tryFreeze({ scope, configDigest, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw new Error("The idle Node was not frozen.");
    live.delete(1001);
    expect(() =>
      first.registerSession({
        scope,
        configDigest: `sha256:${"b".repeat(64)}`,
        ownerPid: 3001,
      }),
    ).toThrow("cannot change its configuration binding");
    const replacement = first.registerSession({ scope, configDigest, ownerPid: 3001 });
    expect(first.tryAcquireWork(replacement)).toBeNull();
    expect(second.unfreeze(frozen.freeze)).toBe(true);
    const claim = first.tryAcquireWork(replacement);
    expect(claim).not.toBeNull();
    first.releaseWork(claim!);
    first.unregisterSession(replacement);
  } finally {
    first.close();
    second.close();
  }
});

it("changes a frozen configuration only after the exact Node stops and keeps replacement work frozen", async () => {
  const { first, second, scope, configDigest } = await fixture();
  try {
    const session = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    const selected = second.tryFreeze({ scope, configDigest, ownerPid: 2001 });
    if (selected.status !== "frozen") throw new Error("The idle Node was not frozen.");
    const next = `sha256:${"b".repeat(64)}`;
    const input = {
      freeze: selected.freeze,
      expectedConfigDigest: configDigest,
      configDigest: next,
    };
    expect(second.replaceFrozenConfiguration(input)).toBe(false);
    first.unregisterSession(session);
    expect(
      second.replaceFrozenConfiguration({ ...input, freeze: { ...input.freeze, token: "wrong" } }),
    ).toBe(false);
    expect(second.replaceFrozenConfiguration(input)).toBe(true);
    expect(second.replaceFrozenConfiguration(input)).toBe(false);
    const replacement = first.registerSession({ scope, configDigest: next, ownerPid: 3001 });
    expect(first.tryAcquireWork(replacement)).toBeNull();
    first.unregisterSession(replacement);
    expect(
      second.replaceFrozenConfiguration({ ...input, expectedConfigDigest: next, configDigest }),
    ).toBe(true);
    const restored = first.registerSession({ scope, configDigest, ownerPid: 1001 });
    expect(first.tryAcquireWork(restored)).toBeNull();
    expect(second.unfreeze(selected.freeze)).toBe(true);
    const claim = first.tryAcquireWork(restored);
    expect(claim).not.toBeNull();
    first.releaseWork(claim!);
    first.unregisterSession(restored);
  } finally {
    first.close();
    second.close();
  }
});
