import { expect, it } from "vitest";
import { nativeCasError } from "../src/native-cas-error.js";
import type { NativeCasFailure } from "../src/native-cas.js";

const failed: NativeCasFailure = {
  status: "failed",
  created: false,
  code: "system_error",
  errno: 2,
  syscall: "lstat",
  pathIndex: 0,
};

it("maps absence only at the target observation boundary", () => {
  expect(nativeCasError(["/target"], failed, "uri")).toMatchObject({
    name: "CasError",
    code: "not_found",
  });
  expect(
    nativeCasError(["/tmp", "/prefix", "/target"], { ...failed, pathIndex: 2 }, "uri"),
  ).toMatchObject({ code: "not_found" });
  for (const syscall of ["open", "read", "close"] as const)
    expect(nativeCasError(["/target"], { ...failed, syscall }, "uri")).toMatchObject({
      code: "ENOENT",
      errno: -2,
      syscall,
      path: "/target",
    });
  expect(
    nativeCasError(["/tmp", "/prefix", "/target"], { ...failed, pathIndex: 1 }, "uri"),
  ).toMatchObject({ code: "ENOENT", path: "/prefix" });
});

it("preserves link coordinates and unsafe-path failures", () => {
  expect(
    nativeCasError(["/tmp", "/prefix", "/target"], { ...failed, syscall: "link" }, "uri"),
  ).toMatchObject({ code: "ENOENT", syscall: "link", path: "/tmp", dest: "/target" });
  expect(
    nativeCasError(["/target"], { ...failed, code: "unsafe_path", errno: 0 }, "uri"),
  ).toMatchObject({ name: "CasError", code: "unsafe_path" });
});
