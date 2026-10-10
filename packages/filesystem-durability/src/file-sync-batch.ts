import type { FileHandle } from "node:fs/promises";

import { loadNativeFileSync, type NativeFileSync } from "./native-file-sync.js";

type SyncHandle = Pick<FileHandle, "fd" | "sync">;
interface Member {
  prepared: Promise<SyncHandle>;
  resolve: (handle: SyncHandle) => void;
  reject: (error: unknown) => void;
}

async function syncIndividually(handles: SyncHandle[]): Promise<void> {
  const results = await Promise.allSettled(
    handles.map((handle) => Promise.resolve().then(() => handle.sync())),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "File synchronization failed.");
}

/** One bounded synchronization queue per owning store; accepted preparations always drain. */
export function createFileSyncBatch(native: NativeFileSync | undefined = loadNativeFileSync()) {
  let admitted = 0;
  let scheduled = false;
  let pending: Member[] = [];

  function schedule(): void {
    if (scheduled || !pending.length) return;
    scheduled = true;
    setImmediate(() => {
      const members = pending;
      pending = [];
      scheduled = false;
      void flush(members);
    });
  }

  async function flush(members: Member[]): Promise<void> {
    try {
      const prepared = await Promise.allSettled(members.map((member) => member.prepared));
      const failures = prepared.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
      if (failures.length) throw new AggregateError(failures, "File preparation failed.");
      const handles = prepared.map((r) => (r as PromiseFulfilledResult<SyncHandle>).value);
      const grouped = await native!.synchronize(handles.map((handle) => handle.fd));
      if (grouped === false) await syncIndividually(handles);
      else if (grouped !== true) throw new Error("Invalid native synchronization result.");
      members.forEach((member, i) => member.resolve(handles[i]!));
    } catch (error) {
      members.forEach((member) => member.reject(error));
    } finally {
      admitted -= members.length;
    }
  }

  return async function synchronize<Handle extends SyncHandle>(
    prepare: () => Promise<Handle>,
  ): Promise<Handle> {
    if (!native || admitted >= 16) {
      const handle = await prepare();
      await handle.sync();
      return handle;
    }
    admitted++;
    const prepared = Promise.resolve().then(prepare);
    const result = new Promise<SyncHandle>((resolve, reject) => {
      pending.push({ prepared, resolve, reject });
    });
    void prepared.then(schedule, schedule);
    return result as Promise<Handle>;
  };
}
