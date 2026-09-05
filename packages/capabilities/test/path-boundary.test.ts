import { posix, win32 } from "node:path";

import { expect, it } from "vitest";

import { isPathInsideDirectory } from "../src/path-boundary.js";

it("accepts children with native POSIX and Windows separators", () => {
  expect(isPathInsideDirectory("/root/package", "/root/package/file", posix)).toBe(true);
  expect(isPathInsideDirectory("C:\\root\\package", "C:\\root\\package\\file", win32)).toBe(true);
});

it("rejects roots, siblings, parents, and other Windows volumes", () => {
  expect(isPathInsideDirectory("/root/package", "/root/package", posix)).toBe(false);
  expect(isPathInsideDirectory("/root/package", "/root/package-other/file", posix)).toBe(false);
  expect(isPathInsideDirectory("C:\\root\\package", "C:\\root", win32)).toBe(false);
  expect(isPathInsideDirectory("C:\\root\\package", "D:\\root\\package\\file", win32)).toBe(false);
});
