import {
  openRepositorySupervisionLeases,
  type SQLiteSupervisionOwnerLeaseStore,
} from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { watchLocalEventChanges } from "./local-event-wakeup.js";
import {
  assertNodeSupervisionBinding,
  NodeSupervisionError,
  readInstalledNodeMandate,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import {
  createNodeSupervisionSession,
  type NodeSupervisionSession,
} from "./supervision-session.js";
export type { NodeSupervisionSession } from "./supervision-session.js";

/** One repository-owned durable store; sessions cannot outlive their exclusive owner operation. */
export class NodeSupervisionStore {
  private readonly authorityHistory: SupervisionAuthorityHistory;
  private readonly tasks: SupervisionTaskSource;
  private readonly subscriptions = new Set<() => void>();
  private closing = false;
  private active: Promise<unknown> | null = null;
  private closePromise: Promise<void> | null = null;

  private constructor(
    private readonly storage: ProjectStorage,
    private readonly leases: SQLiteSupervisionOwnerLeaseStore,
    private readonly binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.tasks = new SupervisionTaskSource(storage, binding, now);
    this.authorityHistory = new SupervisionAuthorityHistory(
      storage.events,
      storage.paths.eventDatabase,
      storage.manifest.projectId,
      () => Date.parse(now()),
    );
  }

  static async open(input: {
    repositoryRoot: string;
    binding: NodeSupervisionBinding;
    now?: () => string;
  }): Promise<NodeSupervisionStore> {
    const binding = structuredClone(input.binding);
    assertNodeSupervisionBinding(binding);
    const now = input.now ?? (() => new Date().toISOString());
    const storage = await openProjectStorage(input.repositoryRoot);
    try {
      await readInstalledNodeMandate(storage, binding, now);
      const leases = await openRepositorySupervisionLeases(input.repositoryRoot);
      return new NodeSupervisionStore(storage, leases, binding, now);
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  subscribe(notify: () => void): () => void {
    if (this.closing) throw new NodeSupervisionError("supervision_session_closed");
    const stop = watchLocalEventChanges(
      { path: this.storage.paths.eventDatabase, latest: () => this.storage.events.latest() },
      notify,
    );
    const unsubscribe = () => {
      stop();
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  nextAuthorityAuditAt(): number | null {
    const times = [this.authorityHistory.nextAuditAt(), this.tasks.nextAuditAt()].filter(
      (time): time is number => time !== null,
    );
    return times.length === 0 ? null : Math.min(...times);
  }

  async withOwner<T>(
    operation: (session: NodeSupervisionSession) => Promise<T>,
  ): Promise<T | null> {
    if (this.closing) throw new NodeSupervisionError("supervision_session_closed");
    if (this.active !== null) return null;
    const acquired = this.leases.acquire({
      supervisionId: this.binding.supervisionId,
      ownerAgentId: this.binding.ownerAgentId,
      nowMs: Date.parse(this.now()),
      durationMs: 300_000,
    });
    if (acquired === null) return null;
    const owner = createNodeSupervisionSession({
      storage: this.storage,
      leases: this.leases,
      binding: this.binding,
      now: this.now,
      tasks: this.tasks,
      authorityHistory: this.authorityHistory,
      acquired,
    });
    const pending = Promise.resolve().then(() => operation(owner.session));
    this.active = pending;
    try {
      return await pending;
    } finally {
      try {
        owner.close();
      } finally {
        this.active = null;
      }
    }
  }

  close(): Promise<void> {
    this.closing = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.closePromise ??= (async () => {
      await this.active?.catch(() => undefined);
      this.leases.close();
      await this.storage.close();
    })();
    return this.closePromise;
  }
}
