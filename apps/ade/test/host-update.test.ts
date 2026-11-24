import { beforeEach, describe, expect, it } from "vitest";

import {
  bindHostUpdate,
  nextUpdate,
  olderVersion,
  restartHost,
  settleHostUpdate,
  updateFor,
  useConnectionStore,
} from "../src/features/connection";
import { type HostIdentity, type HostReplacement, RequestFailure } from "../src/ports";

function fakeReplacement(replace: () => Promise<void> = async () => undefined) {
  const listeners = new Set<(identity: HostIdentity) => void>();
  const replacement: HostReplacement & { identity: HostIdentity | null } = {
    identity: null,
    onIdentity(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace,
  };
  const identify = (identity: HostIdentity) => {
    replacement.identity = identity;
    for (const listener of listeners) listener(identity);
  };
  return { replacement, identify, listeners };
}

const older = { hostVersion: "0.3.0", appVersion: "0.3.1", replaceable: true };

describe("the session host update", () => {
  beforeEach(() => useConnectionStore.setState({ update: { kind: "none" } }));

  it("compares versions by major, minor, and patch", () => {
    expect(olderVersion("0.3.0", "0.3.1")).toBe(true);
    expect(olderVersion("0.9.9", "0.10.0")).toBe(true);
    expect(olderVersion("0.3.1", "0.3.1")).toBe(false);
    expect(olderVersion("0.4.0", "0.3.9")).toBe(false);
    expect(olderVersion("unknown", "0.3.1")).toBe(false);
  });

  it("offers a restart only for an older session host the shell can end", () => {
    expect(updateFor(older)).toEqual({ kind: "available" });
    expect(updateFor({ ...older, replaceable: false })).toEqual({ kind: "none" });
    expect(updateFor({ ...older, hostVersion: "0.4.0" })).toEqual({ kind: "none" });
  });

  it("follows each connection's identity until unbound", () => {
    const fake = fakeReplacement();
    fake.replacement.identity = older;
    const unbind = bindHostUpdate(fake.replacement);
    expect(useConnectionStore.getState().update).toEqual({ kind: "available" });
    fake.identify({ ...older, hostVersion: "0.3.1" });
    expect(useConnectionStore.getState().update).toEqual({ kind: "none" });
    unbind();
    expect(fake.listeners.size).toBe(0);
  });

  it("shows the restart in progress, or the shell's code when it fails", async () => {
    await restartHost(fakeReplacement().replacement);
    expect(useConnectionStore.getState().update).toEqual({ kind: "restarting" });
    const failing = fakeReplacement(() =>
      Promise.reject(new RequestFailure("host_replace_unavailable")),
    );
    await restartHost(failing.replacement);
    expect(useConnectionStore.getState().update).toEqual({
      kind: "failed",
      code: "host_replace_unavailable",
    });
  });

  it("ends a restart only when a session host that is not older answers, and says so", () => {
    const restarting = { kind: "restarting" } as const;
    expect(nextUpdate(restarting, older)).toEqual(restarting);
    expect(nextUpdate(restarting, { ...older, hostVersion: "0.3.1" })).toEqual({
      kind: "restarted",
    });
    expect(nextUpdate({ kind: "none" }, { ...older, hostVersion: "0.3.1" })).toEqual({
      kind: "none",
    });
    useConnectionStore.setState({ update: { kind: "restarted" } });
    settleHostUpdate();
    expect(useConnectionStore.getState().update).toEqual({ kind: "none" });
  });
});
