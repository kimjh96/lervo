import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { getSystemErrorName } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNative, type NativeCas, type Operation } from "./native-fixture.js";

describe.runIf(process.platform === "darwin")("private native CAS boundary", () => {
  let root: string, native: NativeCas;
  beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), "lervo-native-cas-contract-"));
    ({ native } = await compileNative(root, "cas"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("publishes without overwriting and reads every existing target afresh", async () => {
    const temporary = resolve(root, "temporary"),
      prefix = resolve(root, "prefix");
    const target = resolve(prefix, "object");
    await writeFile(temporary, "original");
    expect(await native.batch([[temporary, prefix, target], [target]])).toEqual([
      { status: "complete", created: true, bytes: Buffer.from("original") },
      { status: "complete", created: false, bytes: Buffer.from("original") },
    ]);
    await rm(temporary);
    await writeFile(temporary, "replacement");
    await writeFile(target, "changed existing target");
    expect(await native.batch([[temporary, prefix, target], [target]])).toEqual([
      { status: "complete", created: false, bytes: Buffer.from("changed existing target") },
      { status: "complete", created: false, bytes: Buffer.from("changed existing target") },
    ]);
    expect(await readFile(temporary, "utf8")).toBe("replacement");
  });

  it("returns empty and exact-boundary bodies, but never truncated success for larger bodies", async () => {
    for (const size of [0, 65536, 65537, 1024 * 1024]) {
      const temporary = resolve(root, `size-${size}`),
        prefix = resolve(root, `prefix-${size}`);
      const target = resolve(prefix, "object"),
        bytes = Buffer.alloc(size, 97);
      await writeFile(temporary, bytes);
      const results = await native.batch([[temporary, prefix, target], [target]]);
      expect(results).toEqual(
        [true, false].map((created) =>
          size <= 65536 ? { status: "complete", created, bytes } : { status: "large", created },
        ),
      );
      expect(await readFile(target)).toEqual(bytes);
    }
  });

  it("keeps per-item errors and continues independent operations", async () => {
    const good = resolve(root, "good"),
      missing = resolve(root, "missing");
    await writeFile(good, "valid");
    const results = await native.batch([[missing], [good]]);
    expect(results[0]).toMatchObject({
      status: "failed",
      created: false,
      code: "system_error",
      syscall: "lstat",
      pathIndex: 0,
    });
    const failure = results[0]!;
    if (failure.status !== "failed") throw Error("Missing failure");
    expect(getSystemErrorName(-failure.errno)).toBe("ENOENT");
    expect(results[1]).toEqual({ status: "complete", created: false, bytes: Buffer.from("valid") });
    expect(JSON.stringify(failure)).not.toContain(missing);
  });

  it("has one winning publication when independent groups race for the same target", async () => {
    const prefix = resolve(root, "racing-prefix"),
      target = resolve(prefix, "object");
    const inputs = [resolve(root, "racing-a"), resolve(root, "racing-b")];
    await Promise.all(inputs.map((path) => writeFile(path, "same bytes")));
    const results = (
      await Promise.all(inputs.map((path) => native.batch([[path, prefix, target]])))
    ).flat();
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      results.every(
        (result) => result.status === "complete" && result.bytes.equals(Buffer.from("same bytes")),
      ),
    ).toBe(true);
  });

  it("rejects linked prefixes and linked or non-regular targets", async () => {
    const real = resolve(root, "real-prefix"),
      linked = resolve(root, "linked-prefix");
    await mkdir(real);
    await symlink(real, linked);
    const temporary = resolve(root, "unsafe-temporary");
    await writeFile(temporary, "private body");
    expect(await native.batch([[temporary, linked, resolve(linked, "object")]])).toEqual([
      {
        status: "failed",
        created: false,
        code: "unsafe_path",
        errno: 0,
        syscall: "lstat",
        pathIndex: 1,
      },
    ]);
    expect(await readdir(real)).toEqual([]);
    const link = resolve(root, "linked-target");
    await symlink(temporary, link);
    for (const target of [real, link])
      expect(await native.batch([[target]])).toEqual([
        {
          status: "failed",
          created: false,
          code: "unsafe_path",
          errno: 0,
          syscall: "lstat",
          pathIndex: 0,
        },
      ]);
  });

  it("reports a missing publication parent before linking and preserves the temporary file", async () => {
    const temporary = resolve(root, "parent-temporary"),
      prefix = resolve(root, "absent", "prefix");
    await writeFile(temporary, "retained");
    expect(await native.batch([[temporary, prefix, resolve(prefix, "target")]])).toMatchObject([
      { status: "failed", created: false, code: "system_error", syscall: "mkdir", pathIndex: 1 },
    ]);
    expect(await readFile(temporary, "utf8")).toBe("retained");
  });

  it("rejects malformed or oversized admission before any filesystem effect", async () => {
    const bad: unknown[] = [
      [],
      Array(17).fill([root]),
      null,
      [[root, root]],
      [[""]],
      [["relative"]],
      [[root + "\0tail"]],
      [["/" + "x".repeat(4095)]],
      [["/" + "é".repeat(2048)]],
      [[123]],
    ];
    for (const value of bad)
      expect(() => native.batch(value as Operation[])).toThrow(
        expect.objectContaining({ code: "native_cas_invalid_request" }),
      );
    const before = await readdir(root);
    expect(() =>
      native.batch([
        [resolve(root, "unused"), resolve(root, "unused-prefix"), resolve(root, "unused-target")],
        ["relative"],
      ]),
    ).toThrow();
    expect(await readdir(root)).toEqual(before);
  });

  it("copies admitted paths and bounds retained groups until every completion settles", async () => {
    const target = resolve(root, "capacity");
    await writeFile(target, "snapshot");
    const request: Operation[] = [[target]];
    const first = native.batch(request);
    request[0]![0] = resolve(root, "unrelated");
    const admitted = [first, ...Array.from({ length: 15 }, () => native.batch([[target]]))];
    expect(() => native.batch([[target]])).toThrow(
      expect.objectContaining({ code: "native_cas_capacity" }),
    );
    for (const result of await Promise.all(admitted))
      expect(result).toEqual([
        { status: "complete", created: false, bytes: Buffer.from("snapshot") },
      ]);
    expect(await native.batch([[target]])).toHaveLength(1);
  });
});
