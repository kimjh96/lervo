import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileNative, nativeRoot } from "./native-fixture.js";

describe.runIf(process.platform === "darwin")("native CAS completion failures", () => {
  it.each([false, true])(
    "rejects result allocation failure, pending exception %s",
    async (exception) => {
      const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-completion-"));
      try {
        const { native } = await compileNative(root, "completion", {
          binding: `
#include <node_api.h>
static napi_status failOnce(napi_env env, size_t length, const void *data, void **copy, napi_value *result) {
  static int calls = 0;
  if (!calls++) {
    ${exception ? '(void)napi_throw_error(env, "injected_failure", "Injected allocation failure.");' : ""}
    return ${exception ? "napi_pending_exception" : "napi_generic_failure"};
  }
  return napi_create_buffer_copy(env, length, data, copy, result);
}
#define napi_create_buffer_copy failOnce
#include ${JSON.stringify(resolve(nativeRoot, "binding.c"))}
`,
        });
        const path = resolve(root, "body");
        await writeFile(path, "fixture");
        await expect(native.batch([[path]])).rejects.toMatchObject({
          code: exception ? "injected_failure" : "native_cas_completion_failed",
        });
        const results = await Promise.all(Array.from({ length: 16 }, () => native.batch([[path]])));
        expect(results.every(([value]) => value?.status === "complete")).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("releases all admission state when queuing fails", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-queue-"));
    try {
      const { native } = await compileNative(root, "queue", {
        binding: `
#include <node_api.h>
static napi_status failOnce(napi_env env, napi_async_work work) {
  static int calls = 0;
  if (!calls++) return napi_generic_failure;
  return napi_queue_async_work(env, work);
}
#define napi_queue_async_work failOnce
#include ${JSON.stringify(resolve(nativeRoot, "binding.c"))}
`,
      });
      const path = resolve(root, "body");
      await writeFile(path, "fixture");
      expect(() => native.batch([[path]])).toThrow(
        expect.objectContaining({ code: "native_cas_schedule_failed" }),
      );
      const results = await Promise.all(Array.from({ length: 16 }, () => native.batch([[path]])));
      expect(results.every(([value]) => value?.status === "complete")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
