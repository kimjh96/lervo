import { randomUUID } from "node:crypto";
import {
  HubRuntimeChangeError,
  type HubRuntimeChangeScope,
  type HubRuntimeChangeSource,
} from "@lervo/hub-sync";

type Entry = { cursor: string; listeners: Set<() => void> };

export class RuntimeChangeNotifications implements HubRuntimeChangeSource {
  private readonly entries = new Map<string, Entry>();
  private waiting = 0;
  private closed = false;

  private key(scope: HubRuntimeChangeScope): string {
    return JSON.stringify([
      scope.topic,
      scope.projectId,
      scope.repositoryIdentityHash,
      scope.topic === "command" ? scope.destinationId : null,
    ]);
  }

  notify(scope: HubRuntimeChangeScope): void {
    const entry = this.entries.get(this.key(scope));
    if (entry === undefined) return;
    entry.cursor = randomUUID();
    for (const listener of [...entry.listeners]) listener();
  }

  async waitForRuntimeChange(
    input: Parameters<HubRuntimeChangeSource["waitForRuntimeChange"]>[0],
  ): Promise<{ cursor: string; status: "changed" | "timeout" }> {
    if (this.closed) throw new HubRuntimeChangeError("source_closed");
    if (this.waiting >= 1_024) throw new HubRuntimeChangeError("capacity_exceeded");
    const key = this.key(input);
    let entry = this.entries.get(key);
    if (entry === undefined) {
      if (this.entries.size >= 1_024) {
        const unused = [...this.entries].find(([, value]) => value.listeners.size === 0);
        if (unused === undefined) throw new HubRuntimeChangeError("capacity_exceeded");
        this.entries.delete(unused[0]);
      }
      entry = { cursor: randomUUID(), listeners: new Set() };
      this.entries.set(key, entry);
    }
    const selected = entry;
    if (input.cursor !== selected.cursor) return { cursor: selected.cursor, status: "changed" };
    this.waiting += 1;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 25_000);
      selected.listeners.add(finish);
      input.signal.addEventListener("abort", finish, { once: true });
      if (input.signal.aborted) finish();
      function finish(): void {
        clearTimeout(timer);
        selected.listeners.delete(finish);
        input.signal.removeEventListener("abort", finish);
        resolve();
      }
    });
    this.waiting -= 1;
    return {
      cursor: selected.cursor,
      status: input.cursor === selected.cursor ? "timeout" : "changed",
    };
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values())
      for (const listener of [...entry.listeners]) listener();
    this.entries.clear();
  }
}
