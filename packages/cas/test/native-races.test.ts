import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileNative, nativeRoot } from "./native-fixture.js";

describe.runIf(process.platform === "darwin")("native CAS descriptor ownership", () => {
  it.each(["symlink", "fifo", "file"])(
    "rejects a target replaced with %s after lstat",
    async (kind) => {
      const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-race-"));
      try {
        const target = resolve(root, "target"),
          replacement = resolve(root, "replacement");
        await writeFile(target, "original");
        await writeFile(replacement, "other inode");
        const { native } = await compileNative(root, "race", {
          kernel: `
#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
static int replaceBeforeOpen(const char *path, int flags) {
  if (rename(path, ${JSON.stringify(resolve(root, "original"))}) < 0) return -1;
  ${kind === "symlink" ? `if (symlink(${JSON.stringify(replacement)}, path) < 0) return -1;` : kind === "fifo" ? "if (mkfifo(path, 0600) < 0) return -1;" : `if (link(${JSON.stringify(replacement)}, path) < 0) return -1;`}
  return open(path, flags);
}
#define open replaceBeforeOpen
#include ${JSON.stringify(resolve(nativeRoot, "cas-io.c"))}
`,
        });
        expect(await native.batch([[target]])).toMatchObject([
          {
            status: "failed",
            code: "unsafe_path",
            created: false,
            syscall: kind === "symlink" ? "open" : "fstat",
          },
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("retries interrupted reads, handles short reads, and does not retry close", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-close-"));
    try {
      const { native } = await compileNative(root, "close", {
        kernel: `
#include <errno.h>
#include <unistd.h>
static ssize_t shortRead(int fd, void *bytes, size_t size) {
  static int calls = 0;
  if (!calls++) { errno = EINTR; return -1; }
  return read(fd, bytes, size > 3 ? 3 : size);
}
static int failedClose(int fd) {
  static int calls = 0;
  int result = close(fd);
  if (!calls++) { errno = EINTR; return -1; }
  return result;
}
#define read shortRead
#define close failedClose
#include ${JSON.stringify(resolve(nativeRoot, "cas-io.c"))}
`,
      });
      const path = resolve(root, "body");
      await writeFile(path, "longer than three bytes");
      expect(await native.batch([[path], [path]])).toEqual([
        {
          status: "failed",
          created: false,
          code: "system_error",
          syscall: "close",
          errno: 4,
          pathIndex: 0,
        },
        { status: "complete", created: false, bytes: Buffer.from("longer than three bytes") },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
