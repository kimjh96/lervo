import { describe, expect, it } from "vitest";

import {
  decideKnowledgeConvergenceOwnerMutation,
  isKnowledgeConvergenceOwnerMutation,
  readKnowledgeConvergenceOwnerLease,
  type KnowledgeConvergenceOwnerLease,
  type KnowledgeConvergenceOwnerMutation,
} from "../src/knowledge-convergence-owner-lease.js";

const repositoryIdentityHash = `sha256:${"3".repeat(64)}`;
const mac = `sha256:${"1".repeat(64)}`;
const wsl = `sha256:${"2".repeat(64)}`;
const ttlMs = 30 * 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 5, 0, minutes)).toISOString();

function claim(hostHash: string, hostLabel: string): KnowledgeConvergenceOwnerMutation {
  return {
    operation: "claim",
    request: {
      schemaVersion: 1,
      projectId: "prj_convergence_owner",
      repositoryIdentityHash,
      hostHash,
      hostLabel,
      ttlMs,
    },
  };
}

function release(hostHash: string, generation: number): KnowledgeConvergenceOwnerMutation {
  return {
    operation: "release",
    request: {
      schemaVersion: 1,
      projectId: "prj_convergence_owner",
      repositoryIdentityHash,
      hostHash,
      generation,
    },
  };
}

function apply(
  current: KnowledgeConvergenceOwnerLease | null,
  mutation: KnowledgeConvergenceOwnerMutation,
  minutes: number,
) {
  return decideKnowledgeConvergenceOwnerMutation({ current, mutation, acceptedAt: at(minutes) });
}

describe("knowledge convergence owner lease decision", () => {
  it("grants a vacant lease, renews for the holder, and refuses another host while live", () => {
    const granted = apply(null, claim(mac, "mac"), 0);
    expect(granted.decision).toMatchObject({ status: "granted", predecessor: null });
    expect(granted.next).toMatchObject({ holderHostHash: mac, generation: 1, expiresAt: at(30) });
    const refused = apply(granted.next, claim(wsl, "wsl"), 29);
    expect(refused).toMatchObject({
      next: granted.next,
      decision: { status: "held_elsewhere", lease: { holderHostHash: mac } },
    });
    const renewed = apply(granted.next, claim(mac, "mac"), 10);
    expect(renewed.decision.status).toBe("renewed");
    expect(renewed.next).toMatchObject({ generation: 1, acquiredAt: at(0), expiresAt: at(40) });
  });

  it("hands an expired or released lease to the next host with a new generation", () => {
    const first = apply(null, claim(mac, "mac"), 0).next;
    const expired = apply(first, claim(wsl, "wsl"), 30);
    expect(expired.decision).toMatchObject({
      status: "granted",
      predecessor: { holderHostHash: mac, generation: 1, ended: "expired" },
      lease: { holderHostHash: wsl, generation: 2 },
    });
    expect(apply(expired.next, release(mac, 1), 31).decision.status).toBe("not_holder");
    const released = apply(expired.next, release(wsl, 2), 31);
    expect(released.decision).toMatchObject({
      status: "released",
      lease: { releasedAt: at(31), expiresAt: at(31) },
    });
    expect(
      readKnowledgeConvergenceOwnerLease({ current: released.next, acceptedAt: at(31) }),
    ).toMatchObject({ status: "vacant" });
    expect(apply(released.next, claim(mac, "mac"), 31).decision).toMatchObject({
      status: "granted",
      predecessor: { holderHostHash: wsl, ended: "released" },
      lease: { generation: 3 },
    });
  });

  it("validates mutations exactly", () => {
    expect(isKnowledgeConvergenceOwnerMutation(claim(mac, "mac"))).toBe(true);
    expect(isKnowledgeConvergenceOwnerMutation(claim(mac, "Mac Host"))).toBe(false);
    expect(
      isKnowledgeConvergenceOwnerMutation({
        ...claim(mac, "mac"),
        request: { ...claim(mac, "mac").request, ttlMs: 1_000 },
      }),
    ).toBe(false);
    expect(isKnowledgeConvergenceOwnerMutation({ ...release(mac, 1), extra: true })).toBe(false);
    expect(isKnowledgeConvergenceOwnerMutation(release(mac, 0))).toBe(false);
  });
});
