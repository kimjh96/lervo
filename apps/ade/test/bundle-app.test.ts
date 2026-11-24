import { describe, expect, it } from "vitest";

// @ts-expect-error The bundle build is a plain build script without type declarations.
import { builtExecutable, hostTarget, stagedName } from "../scripts/bundle-app.mjs";

describe("the application bundle build", () => {
  it("stages the session host under the name Tauri looks for on the build's target", () => {
    const target = hostTarget("rustc 1.92.0\nbinary: rustc\nhost: aarch64-apple-darwin\n");
    expect(target).toBe("aarch64-apple-darwin");
    expect(stagedName(target)).toBe("lervo-session-host-aarch64-apple-darwin");
    expect(stagedName("x86_64-pc-windows-msvc")).toBe(
      "lervo-session-host-x86_64-pc-windows-msvc.exe",
    );
    expect(() => hostTarget("rustc 1.92.0\n")).toThrow("no host target");
  });

  it("takes the session host's executable from cargo's messages", () => {
    const messages = [
      JSON.stringify({ reason: "compiler-artifact", target: { name: "libc" }, executable: null }),
      "warning: rendered diagnostics stay on stderr",
      JSON.stringify({
        reason: "compiler-artifact",
        target: { name: "lervo-session-host" },
        executable: "/repo/target/release/lervo-session-host",
      }),
      JSON.stringify({ reason: "build-finished", success: true }),
    ].join("\n");
    expect(builtExecutable(messages)).toBe("/repo/target/release/lervo-session-host");
    expect(() => builtExecutable(messages.split("\n")[0])).toThrow("no lervo-session-host");
  });
});
