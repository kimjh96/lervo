import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SQLiteSupervisionOwnerLeaseStore, type SupervisionOwnerLease } from "../src/index.js";
import { SupervisionProcessLock } from "../src/supervision-process-lock.js";

const roots: string[] = [];
const stores: SQLiteSupervisionOwnerLeaseStore[] = [];
const children: ChildProcess[] = [];
const input = {
  supervisionId: "supervision.project",
  ownerAgentId: `agt_${"a".repeat(24)}`,
  nowMs: 1000,
  durationMs: 1000,
};

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-process-recovery-"));
  roots.push(root);
  const path = resolve(root, "leases.sqlite");
  await mkdir(`${path}.owner-locks`, { mode: 0o700 });
  return { root, path };
}

function lockPath(path: string) {
  return resolve(
    `${path}.owner-locks`,
    createHash("sha256").update(input.supervisionId).digest("hex"),
  );
}

function open(path: string) {
  const store = SQLiteSupervisionOwnerLeaseStore.open(path);
  stores.push(store);
  return store;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function startOwner(root: string, path: string) {
  // Execute the source under test in a separate process without using stale build output.
  const sources = {
    "supervision-owner-lease": "../src/supervision-owner-lease.ts",
    "supervision-process-lock": "../src/supervision-process-lock.ts",
    "sqlite-connection": "../../sqlite-connection/src/index.ts",
  };
  for (const [name, path] of Object.entries(sources)) {
    const source = await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
    });
    await writeFile(
      resolve(root, `${name}.js`),
      compiled.outputText.replaceAll('"@lervo/sqlite-connection"', '"./sqlite-connection.js"'),
    );
  }
  await writeFile(resolve(root, "package.json"), JSON.stringify({ type: "module" }));
  const entry = resolve(root, "owner.mjs");
  await writeFile(
    entry,
    `
    import { SQLiteSupervisionOwnerLeaseStore } from "./supervision-owner-lease.js";
    const store = SQLiteSupervisionOwnerLeaseStore.open(process.argv[2]);
    process.send(store.acquire(${JSON.stringify(input)}));
    // Keeps the store, and so its process lock, reachable; a garbage collection would release it.
    setInterval(() => store, 1000);
  `,
  );
  const child = fork(entry, [path], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  children.push(child);
  const lease = await new Promise<SupervisionOwnerLease>((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The fixture owner did not acquire its lease.")),
      5000,
    );
    child.once("message", (message) => {
      clearTimeout(timer);
      accept(message as SupervisionOwnerLease);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("The fixture owner exited early."));
    });
  });
  return { child, lease };
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("supervision owner process recovery", () => {
  it("retains a native lock handle when close fails so release can be retried", async () => {
    const { path } = await fixture();
    const lock = new SupervisionProcessLock(path, input.supervisionId);
    expect(lock.acquire()).not.toBeNull();
    const database = (lock as unknown as { database: DatabaseSync }).database;
    const close = vi.spyOn(database, "close").mockImplementationOnce(() => {
      throw new Error("Native close failed.");
    });
    try {
      expect(() => lock.release()).toThrow("Native close failed.");
    } finally {
      close.mockRestore();
    }
    expect((lock as unknown as { database: DatabaseSync | null }).database).toBe(database);
    expect(() => lock.release()).not.toThrow();
    expect((lock as unknown as { database: DatabaseSync | null }).database).toBeNull();
  });

  it("recovers a killed owner before expiry, fences its token, and preserves unresolved evidence", async () => {
    const { root, path } = await fixture();
    const evidencePath = resolve(root, "pending-effect.json");
    const evidence = '{"status":"requested","usage":"unobserved","reservation":100000}\n';
    await writeFile(evidencePath, evidence);
    const { child, lease } = await startOwner(root, path);
    const next = open(path);
    expect(next.acquire({ ...input, nowMs: 10000 })).toBeNull();
    expect(next.acquire({ ...input, nowMs: 10000 })).toBeNull();
    await stop(child);
    const recovered = next.acquire({ ...input, nowMs: 1500 });
    expect(recovered).toMatchObject({ generation: lease.generation + 1 });
    expect(recovered?.token).not.toBe(lease.token);
    expect(() => next.commit(lease, 1501, () => "stale")).toThrowError(
      expect.objectContaining({ code: "lease_lost" }),
    );
    expect(() => next.renew(lease, 1501, 1000)).toThrow();
    expect(next.commit(recovered!, 1501, () => "recovered")).toBe("recovered");
    expect(await readFile(evidencePath, "utf8")).toBe(evidence);
  });

  it("keeps a live owner's process lock after failed same-process contenders close", async () => {
    const { root, path } = await fixture();
    const owner = open(path);
    owner.acquire(input);
    expect(open(path).acquire({ ...input, nowMs: 10000 })).toBeNull();
    const { lease } = await startOwner(root, path);
    expect(lease).toBeNull();
  });

  it("does not take over an expired legacy lease without process-lock proof", async () => {
    const { path } = await fixture();
    const store = open(path);
    const database = new DatabaseSync(path);
    try {
      database
        .prepare("INSERT INTO supervision_owner_leases VALUES (?, ?, ?, 1, 2000, 0)")
        .run(input.supervisionId, input.ownerAgentId, "legacy-private-token");
    } finally {
      database.close();
    }
    expect(store.acquire({ ...input, nowMs: 10000 })).toBeNull();
  });

  it("allows independent supervision identities to retain ownership across connections", async () => {
    const { path } = await fixture();
    const first = open(path);
    const second = open(path);
    const firstLease = first.acquire(input)!;
    const secondLease = second.acquire({ ...input, supervisionId: "supervision.second" })!;
    expect(secondLease).not.toBeNull();
    first.release(firstLease);
    expect(second.commit(secondLease, 1500, () => "independent")).toBe("independent");
    expect(first.acquire({ ...input, supervisionId: "supervision.second" })).toBeNull();
  });

  it("bounds orphan lock files left by interrupted acquisition", async () => {
    const { path } = await fixture();
    for (let index = 0; index < 4096; index++) {
      await writeFile(resolve(`${path}.owner-locks`, index.toString(16).padStart(64, "0")), "", {
        mode: 0o600,
      });
    }
    expect(() => open(path).acquire(input)).toThrowError(
      expect.objectContaining({ code: "lease_invalid" }),
    );
  }, 30_000);

  it("rejects a replaced process lock and invalidates the old token", async () => {
    const { path } = await fixture();
    const owner = open(path);
    const lease = owner.acquire(input)!;
    await rename(lockPath(path), `${lockPath(path)}-replaced`);
    await writeFile(lockPath(path), "", { mode: 0o600 });
    expect(() => open(path).acquire(input)).toThrowError(
      expect.objectContaining({ code: "lease_invalid" }),
    );
    expect(() => owner.commit(lease, 1500, () => "stale")).toThrowError(
      expect.objectContaining({ code: "lease_lost" }),
    );
  });

  it("does not reinterpret missing protocol evidence as a recoverable lease", async () => {
    const { root, path } = await fixture();
    const { child } = await startOwner(root, path);
    await stop(child);
    const database = new DatabaseSync(path);
    try {
      database.exec("DELETE FROM supervision_owner_process_locks");
    } finally {
      database.close();
    }
    expect(() => open(path).acquire(input)).toThrowError(
      expect.objectContaining({ code: "lease_invalid" }),
    );
  });

  it.each(["", "-journal", "-wal", "-shm"])(
    "rejects a user-owned symlink at the process lock or sidecar %s",
    async (suffix) => {
      const { root, path } = await fixture();
      const target = resolve(root, "user-owned.txt");
      await writeFile(target, "preserve", { mode: 0o600 });
      await symlink(target, `${lockPath(path)}${suffix}`);
      expect(() => open(path).acquire(input)).toThrowError(
        expect.objectContaining({ code: "lease_invalid" }),
      );
      expect(await readFile(target, "utf8")).toBe("preserve");
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a process lock readable by other users",
    async () => {
      const { path } = await fixture();
      await writeFile(lockPath(path), "", { mode: 0o600 });
      await chmod(lockPath(path), 0o644);
      expect(() => open(path).acquire(input)).toThrowError(
        expect.objectContaining({ code: "lease_invalid" }),
      );
    },
  );
});
