import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { SQLiteNodeWorkAdmission, nodeWorkAdmissionScope } from "../src/index.js";
import type { ProcessObservation } from "../src/process-observation.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const birth = (id: string): ProcessObservation => ({
  status: "present",
  identity: `proc_linux_ticks_v1:sha256:${id.repeat(64)}`,
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-process-reuse-"));
  roots.push(root);
  const path = resolve(root, "admission.sqlite"),
    scope = nodeWorkAdmissionScope(resolve(root, "node.json"));
  const configDigest = `sha256:${"f".repeat(64)}`;
  const observations = new Map<number, ProcessObservation>([
    [1001, birth("a")],
    [2001, birth("b")],
    [3001, birth("c")],
  ]);
  const observeProcess = (pid: number) => observations.get(pid) ?? { status: "absent" as const };
  const store = await SQLiteNodeWorkAdmission.open({ path, observeProcess });
  const second = await SQLiteNodeWorkAdmission.open({ path, observeProcess });
  return { store, second, observations, path, scope, configDigest };
}

it("reclaims a reused PID and its stale work claims but excludes its live replacement", async () => {
  const f = await fixture();
  try {
    const old = f.store.registerSession({ ...f, ownerPid: 1001 });
    const claim = f.store.tryAcquireWork(old)!;
    expect(() => f.second.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
    f.observations.set(1001, birth("d"));
    const replacement = f.second.registerSession({ ...f, ownerPid: 1001 });
    expect(() => f.store.tryAcquireWork(old)).toThrow("absent");
    expect(() => f.store.releaseWork(claim)).toThrow("absent");
    expect(f.second.tryFreeze({ ...f, ownerPid: 2001 }).status).toBe("frozen");
    expect(f.second.tryAcquireWork(replacement)).toBeNull();
    expect(() => f.store.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
  } finally {
    f.store.close();
    f.second.close();
  }
});

it("releases a reused freeze PID and refuses its old configuration-replacement authority", async () => {
  const f = await fixture();
  try {
    const session = f.store.registerSession({ ...f, ownerPid: 1001 });
    const frozen = f.second.tryFreeze({ ...f, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw Error("No freeze");
    f.observations.set(2001, birth("d"));
    f.store.unregisterSession(session);
    expect(
      f.second.replaceFrozenConfiguration({
        freeze: frozen.freeze,
        expectedConfigDigest: f.configDigest,
        configDigest: `sha256:${"e".repeat(64)}`,
      }),
    ).toBe(false);
    expect(f.second.unfreeze(frozen.freeze)).toBe(false);
    const replacement = f.store.registerSession({ ...f, ownerPid: 1001 });
    expect(f.store.tryAcquireWork(replacement)).not.toBeNull();
  } finally {
    f.store.close();
    f.second.close();
  }
});

it("retains sessions and freezes when observation is unavailable", async () => {
  const f = await fixture();
  try {
    const session = f.store.registerSession({ ...f, ownerPid: 1001 });
    f.observations.set(1001, { status: "unknown" });
    expect(() => f.second.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
    expect(() => f.store.tryAcquireWork(session)).toThrow("absent");
    f.observations.set(1001, birth("a"));
    const frozen = f.second.tryFreeze({ ...f, ownerPid: 2001 });
    if (frozen.status !== "frozen") throw Error("No freeze");
    f.observations.set(2001, { status: "unknown" });
    expect(f.store.tryAcquireWork(session)).toBeNull();
    expect(f.second.unfreeze(frozen.freeze)).toBe(false);
    expect(() =>
      f.second.registerSession({ ...f, scope: `sha256:${"e".repeat(64)}`, ownerPid: 2001 }),
    ).toThrow("could not be established");
    f.observations.set(2001, birth("b"));
    expect(f.second.unfreeze(frozen.freeze)).toBe(true);
    expect(f.store.tryAcquireWork(session)).not.toBeNull();
  } finally {
    f.store.close();
    f.second.close();
  }
});

it("retains live legacy owners and allows old writers to omit additive identity columns", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.path);
  try {
    const s = f.store.registerSession({ ...f, ownerPid: 1001 });
    db.prepare("UPDATE node_work_session SET owner_identity = NULL WHERE token = ?").run(s.token);
    f.observations.set(1001, birth("d"));
    expect(() => f.second.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
    f.observations.set(1001, { status: "absent" });
    const next = f.second.registerSession({ ...f, ownerPid: 3001 });
    f.second.unregisterSession(next);
    db.prepare("INSERT INTO node_work_session (token,scope,owner_pid) VALUES (?,?,?)").run(
      "legacy",
      f.scope,
      3001,
    );
    expect(() => f.store.registerSession({ ...f, ownerPid: 2001 })).toThrow("already owns");
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
    f.store.close();
    f.second.close();
  }
});

it("migrates an existing version-one store without adopting a live legacy identity", async () => {
  const f = await fixture();
  f.store.close();
  f.second.close();
  const db = new DatabaseSync(f.path);
  db.exec(
    "ALTER TABLE node_work_session DROP COLUMN owner_identity; ALTER TABLE node_work_scope DROP COLUMN freeze_identity;",
  );
  db.prepare("INSERT INTO node_work_scope (scope, config_digest) VALUES (?,?)").run(
    f.scope,
    f.configDigest,
  );
  db.prepare("INSERT INTO node_work_session (token,scope,owner_pid) VALUES (?,?,?)").run(
    "old",
    f.scope,
    1001,
  );
  db.close();
  const reopened = await SQLiteNodeWorkAdmission.open({
    path: f.path,
    observeProcess: (pid) => f.observations.get(pid)!,
  });
  try {
    expect(() => reopened.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
  } finally {
    reopened.close();
  }
});

it("retains ownership written by an incomparable future identity scheme", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.path);
  try {
    const s = f.store.registerSession({ ...f, ownerPid: 1001 });
    db.prepare("UPDATE node_work_session SET owner_identity = ? WHERE token = ?").run(
      `proc_linux_ticks_v2:sha256:${"d".repeat(64)}`,
      s.token,
    );
    expect(() => f.second.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
  } finally {
    db.close();
    f.store.close();
    f.second.close();
  }
});

it("does not hold a write lock during probes or release a row replaced during observation", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.path);
  const original = f.store.registerSession({ ...f, ownerPid: 1001 });
  let replaced = false;
  const probing = await SQLiteNodeWorkAdmission.open({
    path: f.path,
    observeProcess(pid) {
      if (pid === 1001 && !replaced) {
        // A second writer can replace the observed row while the OS probe is in progress.
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "UPDATE node_work_session SET token = ?, owner_identity = ? WHERE token = ?",
          ).run("replacement", `proc_linux_ticks_v1:sha256:${"d".repeat(64)}`, original.token);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        replaced = true;
        return birth("d");
      }
      return f.observations.get(pid) ?? { status: "unknown" };
    },
  });
  try {
    expect(() => probing.registerSession({ ...f, ownerPid: 3001 })).toThrow("already owns");
    expect(replaced).toBe(true);
    expect(db.prepare("SELECT token FROM node_work_session").all()).toEqual([
      { token: "replacement" },
    ]);
  } finally {
    probing.close();
    db.close();
    f.store.close();
    f.second.close();
  }
});
