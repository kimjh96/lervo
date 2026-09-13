import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SQLiteSupervisionOwnerLeaseStore } from "../src/index.js";

const roots: string[] = [];
const stores: SQLiteSupervisionOwnerLeaseStore[] = [];
const ownerAgentId = `agt_${"a".repeat(24)}`;
const input = { supervisionId: "supervision.project", ownerAgentId, nowMs: 1000, durationMs: 1000 };
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-lease-"));
  roots.push(root);
  const path = resolve(root, "leases.sqlite");
  const first = SQLiteSupervisionOwnerLeaseStore.open(path);
  const second = SQLiteSupervisionOwnerLeaseStore.open(path);
  stores.push(first, second);
  return { first, second };
}
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable supervision owner fencing", () => {
  it("observes a same-token renewal without reviving released or replaced ownership", async () => {
    const { first, second } = await fixture();
    const original = first.acquire(input)!;
    const renewed = first.renew(original, 1500, 2000);
    expect(second.observeRenewed(original, 2100)).toEqual(renewed);
    expect(() => second.commit(original, 2100, () => undefined)).toThrow();
    expect(() => second.observeRenewed({ ...original, token: "foreign" }, 2100)).toThrow();
    first.release(renewed);
    expect(() => second.observeRenewed(original, 2100)).toThrow();
    second.acquire({ ...input, nowMs: 2200 });
    expect(() => first.observeRenewed(original, 2200)).toThrow();
  });
  it("excludes another connection even after expiry and fences the previous owner after release", async () => {
    const { first, second } = await fixture();
    const old = first.acquire(input)!;
    expect(second.acquire(input)).toBeNull();
    expect(second.acquire({ ...input, nowMs: 10000 })).toBeNull();
    let effects = 0;
    expect(() => first.commit(old, 2000, () => effects++)).toThrowError(
      expect.objectContaining({ code: "lease_lost" }),
    );
    expect(effects).toBe(0);
    first.release(old);
    const next = second.acquire({ ...input, nowMs: 10000 })!;
    expect(next.generation).toBe(old.generation + 1);
    expect(next.token).not.toBe(old.token);
    expect(() => first.release(old)).toThrowError(expect.objectContaining({ code: "lease_lost" }));
    second.commit(next, 10001, () => effects++);
    expect(effects).toBe(1);
  });

  it("invalidates pre-renewal coordinates and does not unlock on a failed commit", async () => {
    const { first, second } = await fixture();
    const old = first.acquire(input)!;
    const renewed = first.renew(old, 1500, 2000);
    expect(() => first.commit(old, 1600, () => undefined)).toThrow();
    expect(() =>
      first.commit(renewed, 1600, () => {
        throw new Error("fixture");
      }),
    ).toThrow("fixture");
    expect(second.acquire(input)).toBeNull();
    expect(first.commit(renewed, 1600, () => "committed")).toBe("committed");
  });
});
