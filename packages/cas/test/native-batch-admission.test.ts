import { setImmediate as immediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createNativeCasBatch } from "../src/native-cas-batch.js";
import type { NativeCasOperation, NativeCasResult } from "../src/native-cas.js";

const result = (): NativeCasResult => ({
  status: "complete",
  created: false,
  bytes: Buffer.from("fresh"),
});

it("freezes ready groups, copies paths and never shares a completed result", async () => {
  const completions: ((results: NativeCasResult[]) => void)[] = [];
  const native = {
    batch: vi.fn(
      () =>
        new Promise<NativeCasResult[]>((resolve) => {
          completions.push(resolve);
        }),
    ),
  };
  const batch = createNativeCasBatch(native),
    operation: [string] = ["/first"];
  const first = batch(operation),
    peer = batch(["/peer"]);
  operation[0] = "/mutated";
  await immediate();
  expect(native.batch).toHaveBeenNthCalledWith(1, [["/first"], ["/peer"]]);
  const late = batch(["/first"]);
  await immediate();
  expect(native.batch).toHaveBeenNthCalledWith(2, [["/first"]]);
  completions[1]!([result()]);
  await late;
  completions[0]!([result(), result()]);
  await Promise.all([first, peer]);
  const again = batch(["/first"]);
  await immediate();
  completions[2]!([result()]);
  await again;
  expect(native.batch).toHaveBeenCalledTimes(3);
});

it("bounds queued plus in-flight calls and sends overflow to ordinary I/O", async () => {
  let reject!: (error: unknown) => void;
  const native = {
    batch: vi.fn(
      () =>
        new Promise<NativeCasResult[]>((_resolve, fail) => {
          reject = fail;
        }),
    ),
  };
  const batch = createNativeCasBatch(native);
  const requests = Array.from({ length: 16 }, () => batch(["/body"]));
  const settled = Promise.allSettled(requests);
  expect(await batch(["/overflow"])).toBeUndefined();
  await immediate();
  expect(await batch(["/still-overflow"])).toBeUndefined();
  const error = new Error("group failure");
  reject(error);
  expect(await settled).toEqual(
    Array.from({ length: 16 }, () => ({ status: "rejected", reason: error })),
  );
  native.batch.mockImplementation(async () => [result()]);
  expect(await batch(["/recovered"])).toEqual(result());
});

it("falls back only for a synchronous native capacity rejection", async () => {
  const capacity = Object.assign(new Error("capacity"), { code: "native_cas_capacity" });
  const native = {
    batch: vi
      .fn<(_: readonly NativeCasOperation[]) => Promise<NativeCasResult[]>>()
      .mockImplementationOnce(() => {
        throw capacity;
      })
      .mockRejectedValueOnce(capacity)
      .mockImplementationOnce(() => {
        throw null;
      })
      .mockResolvedValue([result()]),
  };
  const batch = createNativeCasBatch(native);
  expect(await batch(["/body"])).toBeUndefined();
  await expect(batch(["/body"])).rejects.toBe(capacity);
  await expect(batch(["/body"])).rejects.toBeNull();
  expect(await batch(["/body"])).toEqual(result());
});

it("rejects malformed groups without settling some members as successful", async () => {
  const badResults: unknown[] = [
    undefined,
    [],
    [result()],
    Array(2),
    [result(), { status: "complete", created: false, bytes: Buffer.alloc(65537) }],
    [
      result(),
      {
        status: "failed",
        created: false,
        code: "system_error",
        errno: 0,
        syscall: "read",
        pathIndex: 0,
      },
    ],
  ];
  for (const results of badResults) {
    const batch = createNativeCasBatch({ batch: async () => results as NativeCasResult[] });
    const settled = await Promise.allSettled([batch(["/a"]), batch(["/b"])]);
    expect(settled).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ code: "native_cas_invalid_result" }),
        }),
      ),
    );
  }
});

it("settles result-property failures and preserves per-operation errors", async () => {
  const failure = new Error("getter failure");
  const native = {
    batch: vi
      .fn()
      .mockResolvedValueOnce([
        {
          get created() {
            throw failure;
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          status: "failed",
          created: false,
          code: "system_error",
          errno: 2,
          syscall: "lstat",
          pathIndex: 0,
        },
      ]),
  };
  const batch = createNativeCasBatch(native);
  await expect(batch(["/a"])).rejects.toBe(failure);
  expect(await batch(["/a"])).toMatchObject({ status: "failed", errno: 2 });
});

it("keeps paths outside native bounds on ordinary I/O", async () => {
  const native = { batch: vi.fn(async () => [result()]) },
    batch = createNativeCasBatch(native);
  for (const path of ["relative", "/with\0null", "/" + "x".repeat(4095), "/" + "é".repeat(2048)])
    expect(await batch([path])).toBeUndefined();
  expect(native.batch).not.toHaveBeenCalled();
  expect(await batch(["/" + "x".repeat(4094)])).toEqual(result());
});
