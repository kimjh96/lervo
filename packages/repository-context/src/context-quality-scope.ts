import { resolve } from "node:path";

export interface QualityRecordingScopeAdmission {
  readonly ready: Promise<void>;
  readonly beforeStorage?: boolean;
  isReady(): boolean;
  admit(): void;
}
interface Scope {
  beforeStorage: boolean;
  prepared: boolean;
  verified: boolean;
  finished: boolean;
  group: Group;
}
interface Group {
  ready: Promise<void>;
  released: boolean;
  members: Map<string, Scope>;
  freeze(): void;
  finish(scope: Scope): void;
}
interface RootScopes {
  entries: Map<string, Scope>;
  joining?: Group;
}

/** Bounded request coordination only; entries contain no reports, storage handles or authority. */
export function createQualityRecordingScopes() {
  const roots = new Map<string, RootScopes>();
  function createGroup(root: string, owner: RootScopes): Group {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const group: Group = {
      ready,
      released: false,
      members: new Map(),
      freeze() {
        if (owner.joining === group) delete owner.joining;
      },
      finish(scope) {
        if (group.released || scope.finished) return;
        group.freeze();
        scope.finished = true;
        if ([...group.members.values()].every((member) => member.finished)) release();
      },
    };
    function release() {
      if (group.released) return;
      group.released = true;
      group.freeze();
      clearTimeout(timer);
      for (const requestId of group.members.keys()) owner.entries.delete(requestId);
      if (owner.entries.size === 0) roots.delete(root);
      group.members.clear();
      resolveReady();
    }
    // One referenced deadline starts with the first member; later members never extend it.
    const timer = setTimeout(release, 50);
    owner.joining = group;
    return group;
  }
  return {
    begin(
      repositoryRoot: string,
      requestId: string,
      beforeStorage = false,
    ): (() => void) | undefined {
      const root = resolve(repositoryRoot);
      let owner = roots.get(root);
      if (
        (!owner && roots.size >= 8) ||
        (owner && (owner.entries.size >= 16 || owner.entries.has(requestId)))
      )
        return undefined;
      if (!owner) {
        owner = { entries: new Map() };
        roots.set(root, owner);
      }
      // Eight observation pairs fit the commit queue's sixteen accepted report slots.
      const group = owner.joining ?? createGroup(root, owner);
      const scope: Scope = {
        beforeStorage,
        prepared: false,
        verified: false,
        finished: false,
        group,
      };
      group.members.set(requestId, scope);
      owner.entries.set(requestId, scope);
      if (group.members.size === 8) group.freeze();
      return () => group.finish(scope);
    },
    admission(
      repositoryRoot: string,
      requestId: string,
      kind: "prepared" | "verified",
    ): QualityRecordingScopeAdmission | undefined {
      const scope = roots.get(resolve(repositoryRoot))?.entries.get(requestId);
      if (!scope || scope.group.released) return undefined;
      const group = scope.group;
      return {
        beforeStorage: scope.beforeStorage,
        ready: group.ready,
        isReady: () => group.released,
        admit() {
          if (group.released) return;
          // Freeze only after the queue owns the report, not when an admission is inspected.
          group.freeze();
          scope[kind] = true;
          if (scope.prepared && scope.verified) group.finish(scope);
        },
      };
    },
  };
}
