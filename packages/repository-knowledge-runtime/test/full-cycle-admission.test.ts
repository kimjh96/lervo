import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { afterEach, expect, it, vi } from "vitest";

import { acquireFullCycleAdmission, onHeldAdmissionSignal } from "../src/full-cycle-admission.js";
import { nextAdmissionPoll } from "../src/full-cycle-admission-store.js";
import { observedHolder } from "../src/full-cycle-admission-wait.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function directory() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-full-cycle-"));
  directories.push(path);
  return path;
}

/**
 * Another process, such as a co-hosted resident's poll, holds the admission database for longer
 * than any one statement's busy wait.
 */
async function holdAdmissionDatabase(
  admission: string,
  begin: "BEGIN IMMEDIATE" | "BEGIN EXCLUSIVE",
  milliseconds = SQLITE_BUSY_TIMEOUT_MS + 1_500,
): Promise<{ released: Promise<void> }> {
  const path = resolve(admission, "full-cycle-admission.sqlite");
  const holder = spawn(process.execPath, [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const database = new DatabaseSync(${JSON.stringify(path)});
     database.exec("${begin}; DELETE FROM waiters WHERE nonce = 'none';");
     process.stdout.write("held\\n");
     setTimeout(() => { database.exec("COMMIT"); database.close(); }, ${milliseconds});`,
  ]);
  await new Promise((ready) => holder.stdout.once("data", ready));
  return { released: new Promise((released) => holder.once("exit", () => released())) };
}

it("never lets two residents hold the full-cycle admission together", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const holders: string[] = [];
  let concurrent = 0;
  let maximum = 0;
  await Promise.all(
    ["/repo/a", "/repo/b", "/repo/c"].map(async (repositoryRoot) => {
      const held = await acquireFullCycleAdmission({
        repositoryRoot,
        signal,
        directory: admission,
        pollMilliseconds: 10,
      });
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      holders.push(repositoryRoot);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      concurrent--;
      await held.release();
    }),
  );
  expect(maximum).toBe(1);
  expect(holders.sort()).toEqual(["/repo/a", "/repo/b", "/repo/c"]);
});

it("reports contention, ends a wait on abort, and takes over a dead holder", async () => {
  const admission = await directory();
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal: new AbortController().signal,
    directory: admission,
  });
  const controller = new AbortController();
  let waited = false;
  const waiting = acquireFullCycleAdmission({
    repositoryRoot: "/repo/b",
    signal: controller.signal,
    directory: admission,
    pollMilliseconds: 10,
    onWait: () => {
      waited = true;
    },
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  expect(waited).toBe(true);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ code: "knowledge_cancelled" });
  await held.release();

  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  db.prepare("INSERT OR REPLACE INTO holder VALUES(1,?,?,?,?,?)").run(
    2_147_483_646,
    "dead",
    "sha256:dead",
    Date.now(),
    Date.now() + 600_000,
  );
  db.close();
  const recovered = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/c",
    signal: new AbortController().signal,
    directory: admission,
  });
  await recovered.release();
});

it("admits waiting upgrades in arrival order before residents that waited longer (ADR-0574)", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const pause = (milliseconds: number) =>
    new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal,
    directory: admission,
  });
  const order: string[] = [];
  const wait = (repositoryRoot: string, priority: "resident" | "upgrade") =>
    acquireFullCycleAdmission({
      repositoryRoot,
      signal,
      directory: admission,
      pollMilliseconds: 5,
      priority,
    }).then(async (held) => {
      order.push(repositoryRoot);
      await pause(20);
      await held.release();
    });
  const resident = wait("/repo/b", "resident");
  await pause(40);
  // Another resident only asks the holder to stop after its current convergence stage.
  expect(await holder.contended()).toBe(true);
  expect(await holder.preempted()).toBe(false);
  const upgrades = [wait("/repo/c", "upgrade")];
  await pause(40);
  upgrades.push(wait("/repo/d", "upgrade"));
  await pause(40);
  expect(await holder.preempted()).toBe(true);
  await holder.release();
  await Promise.all([resident, ...upgrades]);
  expect(order).toEqual(["/repo/c", "/repo/d", "/repo/b"]);
});

it("keeps waiting through a write lock held past the SQLite busy wait (ADR-0576)", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  await (
    await acquireFullCycleAdmission({ repositoryRoot: "/repo/a", signal, directory: admission })
  ).release();
  const { released } = await holdAdmissionDatabase(admission, "BEGIN IMMEDIATE");
  const upgrade = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/b",
    signal,
    directory: admission,
    pollMilliseconds: 10,
    priority: "upgrade",
  });
  await released;
  await upgrade.release();
}, 30_000);

it("releases through a write lock held past the SQLite busy wait (ADR-0576)", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal,
    directory: admission,
    pollMilliseconds: 10,
  });
  const { released } = await holdAdmissionDatabase(admission, "BEGIN IMMEDIATE");
  await held.release();
  await released;
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  expect(db.prepare("SELECT count(*) AS holders FROM holder").get()).toEqual({ holders: 0 });
  db.close();
}, 30_000);

it("wakes the holder for an upgrade that lock contention kept from seeing it at first (ADR-0574, ADR-0602)", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal,
    directory: admission,
  });
  let wakes = 0;
  const unsubscribe = onHeldAdmissionSignal(() => {
    wakes += 1;
  });
  try {
    // The upgrade's first attempt meets another process's write lock, so it sees no holder.
    const { released } = await holdAdmissionDatabase(admission, "BEGIN EXCLUSIVE");
    const upgrade = acquireFullCycleAdmission({
      repositoryRoot: "/repo/b",
      signal,
      directory: admission,
      pollMilliseconds: 10,
      priority: "upgrade",
    });
    await released;
    // Its next attempt sees the holder and asks it to stop at its next stage boundary.
    await vi.waitFor(() => expect(wakes).toBeGreaterThan(0), { timeout: 15_000 });
    expect(await held.preempted()).toBe(true);
    await held.release();
    await (await upgrade).release();
    expect(wakes).toBe(1);
  } finally {
    unsubscribe();
  }
}, 30_000);

it("keeps its heartbeat fresh while an earlier release's waiter queues behind it (ADR-0602)", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal,
    directory: admission,
  });
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  try {
    // An earlier release removes waiters whose heartbeat is old, by age alone; it queued last.
    db.prepare("INSERT INTO waiters VALUES(?,?,?,?,?)").run(
      "earlier",
      process.pid,
      "sha256:earlier",
      Date.now() + 60_000,
      Date.now(),
    );
    const waiting = acquireFullCycleAdmission({
      repositoryRoot: "/repo/b",
      signal,
      directory: admission,
      pollMilliseconds: 10,
    });
    const ours = () =>
      db
        .prepare(
          "SELECT heartbeat FROM waiters WHERE nonce IN (SELECT nonce FROM admission_presence)",
        )
        .get() as { heartbeat: number } | undefined;
    await vi.waitFor(() => expect(ours()).toBeDefined());
    const first = ours()!.heartbeat;
    // Mixed versions only: this waiter retries, which rewrites its heartbeat, while that row lasts.
    await vi.waitFor(() => expect(ours()!.heartbeat).toBeGreaterThan(first), { timeout: 5_000 });
    db.prepare("DELETE FROM waiters WHERE nonce='earlier'").run();
    await held.release();
    await (await waiting).release();
  } finally {
    db.close();
  }
}, 30_000);

it("admits at an earlier release's holder's lease expiry, not after a long retry delay", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  await (
    await acquireFullCycleAdmission({ repositoryRoot: "/repo/a", signal, directory: admission })
  ).release();
  // A live holder of an earlier release: no presence, a lease that ends in 1.5 seconds.
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  const expiresAt = Date.now() + 1_500;
  db.prepare("INSERT INTO holder VALUES(1,?,?,?,?,?)").run(
    process.pid,
    "earlier",
    "sha256:earlier",
    Date.now(),
    expiresAt,
  );
  db.close();
  const started = Date.now();
  // A retry delay far past the lease: only the lease's expiry can admit this waiter in time.
  const waiting = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/b",
    signal,
    directory: admission,
    pollMilliseconds: 8_000,
  });
  expect(Date.now()).toBeGreaterThanOrEqual(expiresAt);
  expect(Date.now() - started).toBeLessThan(4_000);
  await waiting.release();
}, 30_000);

it("answers the holder's queue checks while another process writes (ADR-0576)", async () => {
  const admission = await directory();
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal: new AbortController().signal,
    directory: admission,
  });
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  const upgradeSince = Date.now() - 365 * 24 * 60 * 60_000;
  db.prepare("INSERT INTO waiters VALUES(?,?,?,?,?)").run(
    "upgrade",
    process.pid,
    "sha256:upgrade",
    upgradeSince,
    Date.now(),
  );
  db.close();
  const { released } = await holdAdmissionDatabase(admission, "BEGIN EXCLUSIVE");
  const started = Date.now();
  expect(await held.preempted()).toBe(true);
  expect(await held.contended()).toBe(true);
  expect(Date.now() - started).toBeLessThan(SQLITE_BUSY_TIMEOUT_MS);
  await released;
  await held.release();
}, 30_000);

it("moves an admission database from an earlier release to WAL (ADR-0576)", async () => {
  const admission = await directory();
  const path = resolve(admission, "full-cycle-admission.sqlite");
  const earlier = new DatabaseSync(path);
  earlier.exec(
    "CREATE TABLE holder(slot INTEGER PRIMARY KEY CHECK(slot=1),owner_pid INTEGER NOT NULL,nonce TEXT NOT NULL,repository_hash TEXT NOT NULL,acquired_at INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE waiters(nonce TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,repository_hash TEXT NOT NULL,since INTEGER NOT NULL,heartbeat INTEGER NOT NULL);",
  );
  expect(earlier.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
  earlier.close();
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal: new AbortController().signal,
    directory: admission,
  });
  const later = new DatabaseSync(path);
  expect(later.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  expect(later.prepare("SELECT count(*) AS holders FROM holder").get()).toEqual({ holders: 1 });
  later.close();
  await held.release();
});

it("gives up a short-lived caller's release after its contention wait (ADR-0576)", async () => {
  const admission = await directory();
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal: new AbortController().signal,
    directory: admission,
    pollMilliseconds: 10,
    releaseContentionWaitMilliseconds: 100,
  });
  const { released } = await holdAdmissionDatabase(admission, "BEGIN IMMEDIATE");
  let lockReleased = false;
  void released.then(() => {
    lockReleased = true;
  });
  await held.release();
  expect(lockReleased).toBe(false);
  await released;
  // The row stays until this process exits or the lease lapses.
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  expect(db.prepare("SELECT count(*) AS holders FROM holder").get()).toEqual({ holders: 1 });
  db.close();
}, 30_000);

it("names the admission database in a SQLite failure (ADR-0576)", async () => {
  const admission = await directory();
  await writeFile(resolve(admission, "full-cycle-admission.sqlite"), "not a database".repeat(64));
  await expect(
    acquireFullCycleAdmission({
      repositoryRoot: "/repo/a",
      signal: new AbortController().signal,
      directory: admission,
    }),
  ).rejects.toMatchObject({
    code: "ERR_SQLITE_ERROR",
    message: expect.stringMatching(/^full-cycle-admission\.sqlite: file is not a database/u),
  });
});

/**
 * A resident in another process, of any release: it takes the slot once the holder's lease has
 * expired or its process is gone, and then keeps it while it lives.
 */
async function residentTakingOverLapsedLeases(admission: string) {
  const path = resolve(admission, "full-cycle-admission.sqlite");
  const resident = spawn(process.execPath, [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const database = new DatabaseSync(${JSON.stringify(path)});
     database.exec("PRAGMA busy_timeout = 5000;");
     process.stdout.write("polling\\n");
     const poll = setInterval(() => {
       const now = Date.now();
       database.exec("BEGIN IMMEDIATE");
       const holder = database.prepare("SELECT * FROM holder WHERE slot=1").get();
       const free = holder === undefined || holder.expires_at <= now;
       if (free)
         database.prepare("INSERT OR REPLACE INTO holder VALUES(1,?,?,?,?,?)")
           .run(process.pid, "resident", "sha256:resident", now, now + 600000);
       database.exec("COMMIT");
       if (free) { clearInterval(poll); process.stdout.write("admitted\\n"); setInterval(() => {}, 1000); }
     }, 10);`,
  ]);
  let output = "";
  const listeners = new Set<() => void>();
  resident.stdout.on("data", (chunk: Buffer) => {
    output += String(chunk);
    for (const listener of listeners) listener();
  });
  const seen = (line: string) =>
    new Promise<void>((done) => {
      const check = () => {
        if (!output.split("\n").includes(line)) return;
        listeners.delete(check);
        done();
      };
      listeners.add(check);
      check();
    });
  await seen("polling");
  return { pid: resident.pid, admitted: () => seen("admitted"), stop: () => resident.kill() };
}

/** A long synchronous task, such as an upgrade's plan recompute on a starved host. */
function blockEventLoop(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

it("detects a lease lost while its renewal timer was blocked (ADR-0577)", async () => {
  const admission = await directory();
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/upgrade",
    signal: new AbortController().signal,
    directory: admission,
    priority: "upgrade",
    leaseMilliseconds: 300,
  });
  const resident = await residentTakingOverLapsedLeases(admission);
  try {
    expect(await holder.confirm()).toBe("held");
    blockEventLoop(1_500);
    await resident.admitted();
    expect(await holder.confirm()).toBe("lost");
    // Losing the admission is final, and the release leaves the new holder's row alone.
    expect(await holder.confirm()).toBe("lost");
    await holder.release();
    const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
    expect(db.prepare("SELECT owner_pid FROM holder").get()).toEqual({ owner_pid: resident.pid });
    db.close();
  } finally {
    resident.stop();
  }
}, 30_000);

it("never confirms when lock contention hides a takeover and the wall clock stepped back (ADR-0577)", async () => {
  const admission = await directory();
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/upgrade",
    signal: new AbortController().signal,
    directory: admission,
    priority: "upgrade",
    leaseMilliseconds: 300,
    confirmContentionWaitMilliseconds: 100,
  });
  const resident = await residentTakingOverLapsedLeases(admission);
  const confirmedAt = Date.now();
  const lock = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  try {
    blockEventLoop(1_500);
    // Before any renewal can run, another connection holds the write lock, and the wall clock
    // steps back to when the holder last confirmed its lease.
    lock.exec("BEGIN EXCLUSIVE");
    try {
      vi.spyOn(Date, "now").mockReturnValue(confirmedAt);
      expect(await holder.confirm()).toBe("unconfirmed");
    } finally {
      vi.restoreAllMocks();
      lock.exec("COMMIT");
    }
    await resident.admitted();
    await holder.release();
  } finally {
    lock.close();
    resident.stop();
  }
}, 60_000);

it("keeps a lapsed lease that no other holder took (ADR-0577)", async () => {
  const admission = await directory();
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/upgrade",
    signal: new AbortController().signal,
    directory: admission,
    leaseMilliseconds: 300,
  });
  blockEventLoop(600);
  expect(await holder.confirm()).toBe("held");
  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  const row = db.prepare("SELECT expires_at FROM holder").get() as { expires_at: number };
  expect(row.expires_at).toBeGreaterThan(Date.now());
  db.close();
  await holder.release();
  expect(await holder.confirm()).toBe("lost");
});

it("confirms through a write lock held for 12 seconds, past several busy waits (ADR-0577)", async () => {
  const admission = await directory();
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/upgrade",
    signal: new AbortController().signal,
    directory: admission,
    priority: "upgrade",
    pollMilliseconds: 10,
  });
  const { released } = await holdAdmissionDatabase(admission, "BEGIN EXCLUSIVE", 12_000);
  const started = performance.now();
  expect(await holder.confirm()).toBe("held");
  expect(performance.now() - started).toBeGreaterThan(2 * SQLITE_BUSY_TIMEOUT_MS);
  await released;
  await holder.release();
}, 60_000);

it("backs an admission waiter off without letting its heartbeat go stale (ADR-0598)", () => {
  const polls = [1_000];
  for (let index = 0; index < 6; index++) polls.push(nextAdmissionPoll(polls.at(-1)!));
  expect(polls).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000]);
  // With the ±25% jitter the longest wait is 10 s, a third of the 30-second stale bound.
  expect(Math.max(...polls) * 1.25).toBeLessThanOrEqual(10_000);
  // A short test poll backs off relative to itself, so admission stays prompt.
  expect([10, 20, 40, 80, 80].map((poll) => nextAdmissionPoll(poll, 10))).toEqual([
    20, 40, 80, 80, 80,
  ]);
});

it("admits a waiter the moment the holder releases, with no poll (ADR-0602)", async () => {
  const path = await directory();
  const signal = AbortSignal.timeout(30_000);
  const holder = await acquireFullCycleAdmission({
    repositoryRoot: "/one",
    directory: path,
    signal,
  });
  // A minute between retries: only the release's wake can admit the waiter in time.
  const started = Date.now();
  const waiting = acquireFullCycleAdmission({
    repositoryRoot: "/two",
    directory: path,
    signal,
    pollMilliseconds: 60_000,
  });
  await new Promise((settle) => setTimeout(settle, 300));
  await holder.release();
  const admitted = await waiting;
  expect(Date.now() - started).toBeLessThan(5_000);
  await admitted.release();
});

it(
  "admits a waiter when the holder's process dies, with no poll (ADR-0602)",
  { timeout: 60_000 },
  async () => {
    const path = await directory();
    const hooks = resolve(
      import.meta.dirname,
      "../../event-store-sqlite/test/support/register-workspace-source.mjs",
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        hooks,
        "--input-type=module",
        "-e",
        `const { acquireFullCycleAdmission } = await import("@lervo/repository-knowledge-runtime");
       await acquireFullCycleAdmission({ repositoryRoot: "/held", directory: process.argv[1], signal: new AbortController().signal });
       process.stdout.write("held\\n");
       setInterval(() => {}, 1 << 30);`,
        path,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolveHeld, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("held")) resolveHeld();
        });
        child.once("exit", () => reject(new Error("The holder exited before holding.")));
      });
      const waiting = acquireFullCycleAdmission({
        repositoryRoot: "/waiting",
        directory: path,
        signal: AbortSignal.timeout(30_000),
        pollMilliseconds: 60_000,
      });
      await new Promise((settle) => setTimeout(settle, 300));
      const killed = Date.now();
      child.kill("SIGKILL");
      const admitted = await waiting;
      // The held connection closed with the process; the ten-minute lease never had to lapse.
      expect(Date.now() - killed).toBeLessThan(5_000);
      await admitted.release();
    } finally {
      child.kill("SIGKILL");
    }
  },
);

it("keeps the holder it last saw when lock contention hides it, so the retry is not reset", () => {
  const held = (nonce: string) => ({
    admitted: false,
    holder: { nonce, presence: null, expiresAt: 0 },
    ahead: null,
    legacy: true,
  });
  expect(observedHolder(held("first"), null)).toBe("first");
  // Contention: no attempt, and nothing learned about the holder.
  expect(observedHolder(null, "first")).toBe("first");
  expect(observedHolder(held("second"), "first")).toBe("second");
  expect(observedHolder({ ...held("x"), holder: null }, "second")).toBeNull();
});
