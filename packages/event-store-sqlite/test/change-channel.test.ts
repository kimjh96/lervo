import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventStoreChannelDirectory,
  eventStoreChannelLocation,
  inspectEventStoreChannel,
  listenEventStoreChanges,
  notifyEventStoreChange,
  type EventStoreChannelListener,
} from "../src/change-channel.js";
import {
  committedBy,
  readCommitTimes,
  recordCommitTime,
  commitTimesPath,
} from "../src/change-channel-commit-times.js";
import { localBootKey, localHostKey } from "../src/process-identity.js";

const UNIX = process.platform !== "win32";
const source = resolve(import.meta.dirname, "../src/change-channel.ts");
const store = resolve(import.meta.dirname, "../src/index.ts");
const hooks = resolve(import.meta.dirname, "support/register-workspace-source.mjs");
const roots: string[] = [];
const listeners: EventStoreChannelListener[] = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A database path inside `<root>/.lervo/data`, as a repository lays it out. */
function database(depth = 0): string {
  const root = mkdtempSync(join(tmpdir(), "lervo-channel-"));
  roots.push(root);
  const nested = Array.from({ length: depth }, (_, index) => `nested-directory-${index}`);
  const data = join(root, ...nested, ".lervo", "data");
  mkdirSync(data, { recursive: true });
  return join(data, "events.sqlite");
}

function listen(path: string, ping: () => void = () => undefined): EventStoreChannelListener {
  const listener = listenEventStoreChanges(path, ping, () => undefined);
  listeners.push(listener);
  return listener;
}

const fifos = (path: string) =>
  readdirSync(eventStoreChannelDirectory(path)).filter((name) => name.endsWith(".fifo"));
const records = (path: string) => {
  try {
    return readdirSync(eventStoreChannelLocation(path).records);
  } catch {
    return [];
  }
};

/** Every stored event in sequence order, read straight from SQLite. */
function readAll(path: string): { seq: number; eventId: string }[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare("SELECT seq, event_id AS eventId FROM events ORDER BY seq").all() as {
      seq: number;
      eventId: string;
    }[];
  } finally {
    database.close();
  }
}

/** Runs a script in a plain Node process that loads workspace sources the way vitest does. */
function child(script: string, ...args: string[]) {
  return spawn(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      pathToFileURL(hooks).href,
      "--input-type=module",
      "-e",
      script,
      ...args,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
}

async function exited(process: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((settle) => process.on("exit", (code) => settle(code)));
}

async function line(process: ReturnType<typeof spawn>, text: string): Promise<void> {
  let output = "";
  await new Promise<void>((settle) =>
    process.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(text)) settle();
    }),
  );
}

describe.runIf(UNIX)("event store change channel on Unix (ADR-0602)", () => {
  it("keeps the FIFOs in .lervo/run and the records in derived state, or beside the database", () => {
    const path = database();
    const lervo = resolve(path, "../..");
    expect(eventStoreChannelLocation(path)).toEqual({
      run: join(lervo, "run", "events.sqlite"),
      records: join(lervo, "state", "event-channel", "events.sqlite"),
      repositoryLayout: true,
    });
    const elsewhere = mkdtempSync(join(tmpdir(), "lervo-channel-plain-"));
    roots.push(elsewhere);
    expect(eventStoreChannelLocation(join(elsewhere, "events.sqlite")).run).toBe(
      join(realpathSync(elsewhere), "events.sqlite.run"),
    );
    listen(path);
    // Git never sees the run directory.
    expect(readFileSync(join(lervo, "run", ".gitignore"), "utf8")).toBe("*\n");
    expect(fifos(path)[0]).toMatch(
      new RegExp(`^${localHostKey()}-${localBootKey()}-${process.pid}-[0-9a-f]+\\.fifo$`, "u"),
    );
  });

  it("wakes a subscriber when this process commits", async () => {
    const path = database();
    const ping = vi.fn();
    listen(path, ping);
    notifyEventStoreChange(path);
    await vi.waitFor(() => expect(ping).toHaveBeenCalled());
  });

  it("delivers before a writer that exits at once has returned (no directory watch)", async () => {
    const path = database();
    const ping = vi.fn();
    listen(path, ping);
    const writer = child(
      `const { notifyEventStoreChange } = await import(process.argv[1]);
       notifyEventStoreChange(process.argv[2]);
       process.exit(0);`,
      source,
      path,
    );
    expect(await exited(writer)).toBe(0);
    await vi.waitFor(() => expect(ping).toHaveBeenCalled());
  });

  it("wakes a subscriber when a real store commits in another process", async () => {
    const path = database();
    const ping = vi.fn();
    listen(path, ping);
    const writer = child(
      `const { SQLiteEventStore } = await import(process.argv[1]);
       const store = await SQLiteEventStore.open({ path: process.argv[2], projectId: "prj_01234567" });
       store.append({
         eventId: "evt_00000001", projectId: "prj_01234567", runId: "run_01234567",
         sessionId: "ses_01234567", type: "run.completed", occurredAt: "2026-08-18T00:00:01Z",
         actor: { kind: "system" }, schemaVersion: 1, policyVersion: "sha256:" + "a".repeat(64),
         payload: { resultDigest: "sha256:" + "b".repeat(64),
           artifactIds: ["art_" + "b".repeat(64)], verificationStatus: "not_run" },
       });
       process.exit(0);`,
      store,
      path,
    );
    expect(await exited(writer)).toBe(0);
    await vi.waitFor(() => expect(ping).toHaveBeenCalled(), { timeout: 5_000 });
  }, 30_000);

  it("removes a killed subscriber's FIFO and records on the next commit, with no pid check", async () => {
    const path = database();
    const subscriber = child(
      `const { listenEventStoreChanges } = await import(process.argv[1]);
       const listener = listenEventStoreChanges(process.argv[2], () => undefined, () => undefined);
       listener.report([{ code: "event_channel_detector_unavailable", detail: "fixture" }]);
       console.log("ready");
       setInterval(() => undefined, 1_000);`,
      source,
      path,
    );
    await line(subscriber, "ready");
    expect(fifos(path)).toHaveLength(1);
    expect(records(path).some((name) => name.startsWith("subscriber-"))).toBe(true);
    subscriber.kill("SIGKILL");
    await exited(subscriber);
    expect(inspectEventStoreChannel(path)).toEqual([]);
    // Nobody on this kernel holds the FIFO for reading any more, so its open fails with ENXIO.
    notifyEventStoreChange(path);
    expect(fifos(path)).toEqual([]);
    expect(records(path)).toEqual([]);
  }, 30_000);

  it("never unlinks a FIFO of another host or of an unknown identity, and reports it", () => {
    const path = database();
    listen(path);
    const directory = eventStoreChannelDirectory(path);
    // Nobody reads these here; on their own kernels they may be read, so ENXIO proves nothing.
    execFileSync("mkfifo", [
      "-m",
      "600",
      join(directory, "aaaaaaaaaaaa-b0123456789ab-1-00ff.fifo"),
    ]);
    execFileSync("mkfifo", ["-m", "600", join(directory, "unknown-unknown-2-00ff.fifo")]);
    notifyEventStoreChange(path);
    expect(fifos(path)).toEqual(
      expect.arrayContaining([
        "aaaaaaaaaaaa-b0123456789ab-1-00ff.fifo",
        "unknown-unknown-2-00ff.fifo",
      ]),
    );
    expect(
      inspectEventStoreChannel(path)
        .map((issue) => issue.code)
        .sort(),
    ).toEqual(["event_channel_foreign_host", "event_channel_identity_unknown"]);
    // An unknown identity loses no wake: a reader on this kernel still gets its ping.
    const unknown = openSync(
      join(directory, "unknown-unknown-2-00ff.fifo"),
      constants.O_RDWR | constants.O_NONBLOCK,
    );
    try {
      notifyEventStoreChange(path);
      expect(readSync(unknown, Buffer.alloc(16))).toBeGreaterThan(0);
    } finally {
      closeSync(unknown);
    }
  });

  it("removes what a previous boot of this host left, on the next commit and at start", () => {
    const path = database();
    const directory = eventStoreChannelDirectory(path);
    const boot = localBootKey();
    // A boot key of the same kind that is not this boot.
    const previous = boot.startsWith("b")
      ? `b${"0".repeat(12)}`
      : `t${Number(boot.slice(1)) - 86_400}`;
    const leftover = `${localHostKey()}-${previous}-1-00ff`;
    listen(path);
    execFileSync("mkfifo", ["-m", "600", join(directory, `${leftover}.fifo`)]);
    writeFileSync(
      join(eventStoreChannelLocation(path).records, `subscriber-${leftover}.json`),
      "{}",
    );
    notifyEventStoreChange(path);
    expect(fifos(path).some((name) => name.startsWith(leftover))).toBe(false);
    expect(records(path).some((name) => name.includes(leftover))).toBe(false);
    // A subscriber that starts sweeps them as well.
    execFileSync("mkfifo", ["-m", "600", join(directory, `${leftover}.fifo`)]);
    listen(path);
    expect(fifos(path).some((name) => name.startsWith(leftover))).toBe(false);
    expect(inspectEventStoreChannel(path)).toEqual([]);
  });

  it("never removes a live FIFO whose boot key looks like another boot (a clock step)", () => {
    const path = database();
    listen(path);
    const boot = localBootKey();
    const stepped = boot.startsWith("b")
      ? `b${"1".repeat(12)}`
      : `t${Number(boot.slice(1)) + 3_600}`;
    const fifo = join(eventStoreChannelDirectory(path), `${localHostKey()}-${stepped}-1-00aa.fifo`);
    execFileSync("mkfifo", ["-m", "600", fifo]);
    const reader = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    try {
      // Held by a reader on this kernel: only ENXIO may remove it, whatever its boot key says.
      notifyEventStoreChange(path);
      listen(path);
      inspectEventStoreChannel(path);
      expect(fifos(path)).toContain(`${localHostKey()}-${stepped}-1-00aa.fifo`);
    } finally {
      closeSync(reader);
    }
  });

  it("reports a subscriber that left a committed event unobserved, by commit time", async () => {
    const path = database();
    const listener = listen(path);
    listener.observe(5);
    // The writer records when events 6 and 7 were committed, whatever they claim to have occurred.
    recordCommitTime(path, { from: 6, to: 7 });
    const history = (head: number) => ({ headSeq: () => head });
    const later = Date.now() + 60_000;
    expect(inspectEventStoreChannel(path, { history: history(5), now: later })).toEqual([]);
    expect(
      inspectEventStoreChannel(path, { history: history(7), now: later }).map(
        (issue) => issue.code,
      ),
    ).toEqual(["event_channel_subscriber_stalled"]);
    // Within the bound of that commit it is not a stall yet.
    expect(inspectEventStoreChannel(path, { history: history(7), now: Date.now() })).toEqual([]);
    // Observing the head clears it; the write follows within a second.
    listener.observe(7);
    await vi.waitFor(
      () => expect(inspectEventStoreChannel(path, { history: history(7), now: later })).toEqual([]),
      { timeout: 3_000 },
    );
  });

  it("times a gap in the ring by the next later commit, never sooner", () => {
    const times = [
      { from: 3, to: 4, at: 100 },
      { from: 8, to: 9, at: 300 },
    ];
    expect(committedBy(times, 4)).toBe(100);
    // Events 5 to 7 have no entry; they were committed before events 8 and 9.
    expect(committedBy(times, 6)).toBe(300);
    expect(committedBy(times, 1)).toBe(100);
    expect(committedBy(times, 10)).toBeNull();
  });

  it("keeps every racing writer's commit in the ring, under the write lock", async () => {
    const path = database();
    listen(path);
    const barrier = join(resolve(path, "../.."), "start-barrier");
    const writer = (name: string) =>
      child(
        `import { existsSync } from "node:fs";
         const { SQLiteEventStore } = await import(process.argv[1]);
         const store = await SQLiteEventStore.open({ path: process.argv[2], projectId: "prj_01234567" });
         console.log("ready");
         // Both writers start together, then append so that their commits interleave.
         while (!existsSync(process.argv[4])) await new Promise((settle) => setImmediate(settle));
         for (let index = 0; index < 200; index += 1) {
           // Yield between commits, so the other writer's busy wait takes the lock in between.
           await new Promise((settle) => setTimeout(settle, 1));
           store.append({
             eventId: "evt_" + process.argv[3] + String(index).padStart(4, "0"), projectId: "prj_01234567",
             runId: "run_01234567", sessionId: "ses_01234567", type: "run.completed",
             occurredAt: "2026-08-18T00:00:01Z", actor: { kind: "system" }, schemaVersion: 1,
             policyVersion: "sha256:" + "a".repeat(64),
             payload: { resultDigest: "sha256:" + "b".repeat(64),
               artifactIds: ["art_" + "b".repeat(64)], verificationStatus: "not_run" },
           });
         }
         store.close();
         process.exit(0);`,
        store,
        path,
        name,
        barrier,
      );
    const first = writer("aaaa");
    const second = writer("bbbb");
    await Promise.all([line(first, "ready"), line(second, "ready")]);
    writeFileSync(barrier, "");
    expect(await Promise.all([exited(first), exited(second)])).toEqual([0, 0]);
    // The commits did interleave: the writer changes many times along the sequence.
    const order = readAll(path).map((event) => event.eventId.slice(4, 8));
    const switches = order.filter((name, index) => index > 0 && name !== order[index - 1]).length;
    expect(switches).toBeGreaterThan(10);
    // Under that interleaving the ring is still contiguous over its last 64 commits. With the entry
    // written after COMMIT, outside the lock, this assertion failed on every run (2026-11-20).
    const ring = readCommitTimes(commitTimesPath(eventStoreChannelLocation(path).records));
    const covered = ring.flatMap((entry) =>
      Array.from({ length: entry.to - entry.from + 1 }, (_, index) => entry.from + index),
    );
    expect(covered).toEqual(
      Array.from({ length: covered.length }, (_, index) => 400 - covered.length + 1 + index),
    );
    expect(ring).toHaveLength(64);
  }, 60_000);

  it("writes the observed head only when it changed, at most once a second", async () => {
    const path = database();
    const listener = listen(path);
    const record = () =>
      JSON.parse(
        readFileSync(
          join(
            eventStoreChannelLocation(path).records,
            records(path).find((name) => name.startsWith("subscriber-"))!,
          ),
          "utf8",
        ),
      ) as { observed?: { seq: number } };
    listener.observe(1);
    expect(record().observed?.seq).toBe(1);
    for (let seq = 2; seq <= 50; seq += 1) listener.observe(seq);
    // Inside the second only the first write happened; the last head follows at its end.
    expect(record().observed?.seq).toBe(1);
    await vi.waitFor(() => expect(record().observed?.seq).toBe(50), { timeout: 3_000 });
  });

  it("never blocks on a stopped subscriber, keeps waking the others, and reports the stall", async () => {
    const path = database();
    const subscriber = child(
      `const { listenEventStoreChanges } = await import(process.argv[1]);
       listenEventStoreChanges(process.argv[2], () => console.log("woke"), () => undefined);
       console.log("ready");
       setInterval(() => undefined, 1_000);`,
      source,
      path,
    );
    await line(subscriber, "ready");
    const ping = vi.fn();
    listen(path, ping);
    subscriber.kill("SIGSTOP");
    try {
      // Fill the stopped subscriber's pipe buffer until it returns EAGAIN.
      const stopped = fifos(path).find((name) => name.includes(`-${subscriber.pid}-`))!;
      const fill = openSync(
        join(eventStoreChannelDirectory(path), stopped),
        constants.O_WRONLY | constants.O_NONBLOCK,
      );
      try {
        for (;;) writeSync(fill, Buffer.alloc(4_096));
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("EAGAIN");
      } finally {
        closeSync(fill);
      }
      // Each commit still returns at once and still wakes the other subscriber.
      for (let commit = 0; commit < 100; commit += 1) {
        const started = performance.now();
        notifyEventStoreChange(path);
        expect(performance.now() - started).toBeLessThan(250);
      }
      await vi.waitFor(() => expect(ping).toHaveBeenCalled());
      expect(inspectEventStoreChannel(path).map((issue) => issue.code)).toEqual([
        "event_channel_subscriber_stalled",
      ]);
      subscriber.kill("SIGCONT");
      await line(subscriber, "woke");
      // The next ping that lands clears the stall.
      await vi.waitFor(() => {
        notifyEventStoreChange(path);
        expect(inspectEventStoreChannel(path)).toEqual([]);
      });
    } finally {
      subscriber.kill("SIGKILL");
    }
  }, 60_000);

  it("refuses a symlinked or group-writable run directory and reports it", () => {
    const path = database();
    const directory = eventStoreChannelDirectory(path);
    const elsewhere = mkdtempSync(join(tmpdir(), "lervo-channel-target-"));
    roots.push(elsewhere);
    mkdirSync(resolve(directory, ".."), { recursive: true, mode: 0o700 });
    symlinkSync(elsewhere, directory);
    const refused = listen(path);
    expect(refused.available()).toBe(false);
    notifyEventStoreChange(path);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(inspectEventStoreChannel(path).map((issue) => issue.code)).toContain(
      "event_channel_refused",
    );
    rmSync(directory);
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o770);
    expect(listen(path).available()).toBe(false);
    expect(inspectEventStoreChannel(path)[0]?.code).toBe("event_channel_refused");
  });

  it("reports a FIFO that a writer cannot open, and clears it once that writer's ping lands", () => {
    const path = database();
    listen(path);
    const blocked = join(
      eventStoreChannelDirectory(path),
      `${localHostKey()}-${localBootKey()}-1-0bad.fifo`,
    );
    execFileSync("mkfifo", ["-m", "000", blocked]);
    notifyEventStoreChange(path);
    expect(inspectEventStoreChannel(path).map((issue) => issue.code)).toEqual([
      "event_channel_subscriber_unreachable",
    ]);
    chmodSync(blocked, 0o600);
    const reader = openSync(blocked, constants.O_RDWR | constants.O_NONBLOCK);
    try {
      notifyEventStoreChange(path);
      expect(inspectEventStoreChannel(path)).toEqual([]);
    } finally {
      closeSync(reader);
    }
  });

  it("reports a missing mkfifo and a filesystem without FIFOs, then recovers", () => {
    const path = database();
    const missing = listenEventStoreChanges(path, vi.fn(), vi.fn(), {
      mkfifo: ["/nonexistent/mkfifo"],
    });
    listeners.push(missing);
    expect(missing.available()).toBe(false);
    expect(inspectEventStoreChannel(path).map((issue) => issue.code)).toEqual([
      "event_channel_mkfifo_missing",
    ]);
    const failing = listenEventStoreChanges(path, vi.fn(), vi.fn(), { mkfifo: ["/usr/bin/false"] });
    listeners.push(failing);
    expect(
      inspectEventStoreChannel(path)
        .map((issue) => issue.code)
        .sort(),
    ).toEqual(["event_channel_mkfifo_missing", "event_channel_unsupported"]);
    missing.close();
    failing.close();
    listeners.splice(0);
    expect(inspectEventStoreChannel(path)).toEqual([]);
  });

  it("rebuilds a removed FIFO, a removed run directory and a removed record", async () => {
    const path = database();
    const ping = vi.fn();
    const listener = listen(path, ping);
    rmSync(join(eventStoreChannelDirectory(path), fifos(path)[0]!));
    expect(listener.verify()).toBe(true);
    expect(listener.verify()).toBe(false);
    rmSync(eventStoreChannelDirectory(path), { recursive: true });
    // While the run directory is gone, the live subscriber's record keeps the loss visible.
    expect(inspectEventStoreChannel(path).map((issue) => issue.code)).toEqual([
      "event_channel_unavailable",
    ]);
    expect(listener.verify()).toBe(true);
    expect(inspectEventStoreChannel(path)).toEqual([]);
    // A state reset moves the records away; the next check writes this subscriber's back.
    rmSync(eventStoreChannelLocation(path).records, { recursive: true });
    expect(listener.verify()).toBe(false);
    expect(records(path).some((name) => name.startsWith("subscriber-"))).toBe(true);
    notifyEventStoreChange(path);
    await vi.waitFor(() => expect(ping).toHaveBeenCalled());
  });

  it("reports a live subscriber's issues until it clears them", () => {
    const path = database();
    const listener = listen(path);
    listener.report([{ code: "event_channel_writer_without_ping", detail: "fixture" }]);
    expect(inspectEventStoreChannel(path)).toEqual([
      { code: "event_channel_writer_without_ping", detail: "fixture" },
    ]);
    listener.report([]);
    expect(inspectEventStoreChannel(path)).toEqual([]);
  });

  it("works for a database path far beyond the 104-byte socket limit", async () => {
    const path = database(8);
    expect(eventStoreChannelDirectory(path).length).toBeGreaterThan(200);
    const ping = vi.fn();
    listen(path, ping);
    notifyEventStoreChange(path);
    await vi.waitFor(() => expect(ping).toHaveBeenCalled());
  });

  it("keeps a separate rendezvous per database", async () => {
    const first = database();
    const second = database();
    expect(eventStoreChannelDirectory(first)).not.toBe(eventStoreChannelDirectory(second));
    const ping = vi.fn();
    listen(first, ping);
    const other = vi.fn();
    listen(second, other);
    notifyEventStoreChange(second);
    await vi.waitFor(() => expect(other).toHaveBeenCalled());
    expect(ping).not.toHaveBeenCalled();
  });
});

describe.runIf(process.platform === "win32")(
  "event store change channel on Windows (ADR-0602)",
  () => {
    const pings = (path: string) =>
      readdirSync(eventStoreChannelDirectory(path)).filter((name) => name.endsWith(".ping"));

    it("wakes a subscriber through its ping file from this process", async () => {
      const path = database();
      const ping = vi.fn();
      const listener = listen(path, ping);
      expect(listener.available()).toBe(true);
      expect(pings(path)).toHaveLength(1);
      notifyEventStoreChange(path);
      await vi.waitFor(() => expect(ping).toHaveBeenCalled());
    });

    it("wakes the subscriber from a writer process that exits at once", async () => {
      const path = database();
      const ping = vi.fn();
      listen(path, ping);
      const writer = child(
        `const { notifyEventStoreChange } = await import(process.argv[1]);
         notifyEventStoreChange(process.argv[2]);
         process.exit(0);`,
        pathToFileURL(source).href,
        path,
      );
      expect(await exited(writer)).toBe(0);
      await vi.waitFor(() => expect(ping).toHaveBeenCalled());
    });

    it("removes an exited subscriber's files on the next commit, proven by its released lock", async () => {
      const path = database();
      const subscriber = child(
        `const { listenEventStoreChanges } = await import(process.argv[1]);
         listenEventStoreChanges(process.argv[2], () => undefined, () => undefined);
         console.log("ready");
         setInterval(() => undefined, 1_000);`,
        pathToFileURL(source).href,
        path,
      );
      await line(subscriber, "ready");
      expect(pings(path)).toHaveLength(1);
      // Held: a commit keeps it.
      notifyEventStoreChange(path);
      expect(pings(path)).toHaveLength(1);
      subscriber.kill();
      await exited(subscriber);
      notifyEventStoreChange(path);
      expect(pings(path)).toEqual([]);
      expect(records(path)).toEqual([]);
    }, 30_000);

    it("keeps a ping file bounded however many commits land", async () => {
      const path = database();
      const ping = vi.fn();
      listen(path, ping);
      // Past the 4 KiB bound; each Windows append is a file open, so keep the count modest.
      for (let commit = 0; commit < 5_000; commit += 1) notifyEventStoreChange(path);
      await vi.waitFor(() => expect(ping).toHaveBeenCalled(), { timeout: 10_000 });
      await vi.waitFor(
        () =>
          expect(
            statSync(join(eventStoreChannelDirectory(path), pings(path)[0]!)).size,
          ).toBeLessThanOrEqual(4_096),
        { timeout: 10_000 },
      );
    }, 60_000);

    it("reports a live subscriber's issues and stops once it closes", () => {
      const path = database();
      const listener = listen(path);
      listener.report([{ code: "event_channel_writer_without_ping", detail: "fixture" }]);
      expect(inspectEventStoreChannel(path)).toEqual([
        { code: "event_channel_writer_without_ping", detail: "fixture" },
      ]);
      listener.close();
      listeners.splice(listeners.indexOf(listener), 1);
      expect(inspectEventStoreChannel(path)).toEqual([]);
      expect(pings(path)).toEqual([]);
    });
  },
);
