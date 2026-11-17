import { expect, it } from "vitest";
import {
  darwinToolchainFields,
  darwinToolchainMismatches,
  darwinToolchainPin,
} from "../lib/darwin-toolchain.mjs";

const observedPin = () =>
  Object.fromEntries(darwinToolchainFields.map((field) => [field, darwinToolchainPin[field]]));

it("accepts exactly the pinned toolchain", () => {
  expect(darwinToolchainMismatches(observedPin())).toEqual([]);
});

it("names every field that differs, including an unavailable Xcode", () => {
  expect(
    darwinToolchainMismatches({
      ...observedPin(),
      developerDir: "/Applications/Xcode_26.6.app/Contents/Developer",
      clang: "Apple clang version 17.0.0 (clang-1700.4.4.1)",
      sdkBuild: null,
    }),
  ).toEqual(["developerDir", "clang", "sdkBuild"]);
  expect(darwinToolchainMismatches(undefined)).toEqual(darwinToolchainFields);
});

it("selects the pinned Xcode through its developer directory", () => {
  const version = darwinToolchainPin.xcode.replace(/^Xcode /u, "");
  expect(darwinToolchainPin.developerDir).toBe(
    `/Applications/Xcode_${version}.app/Contents/Developer`,
  );
});
