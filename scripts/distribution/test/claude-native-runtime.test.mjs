import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { claudeNativePackageName } from "../lib/claude-native-runtime.mjs";

describe("Claude native runtime package selection", () => {
  it("selects macOS and Windows packages by architecture", () => {
    assert.equal(
      claudeNativePackageName({ platform: "darwin", arch: "arm64" }),
      "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    );
    assert.equal(
      claudeNativePackageName({ platform: "darwin", arch: "x64" }),
      "@anthropic-ai/claude-agent-sdk-darwin-x64",
    );
    assert.equal(
      claudeNativePackageName({ platform: "win32", arch: "x64" }),
      "@anthropic-ai/claude-agent-sdk-win32-x64",
    );
  });

  it("keeps glibc and musl Linux packages distinct", () => {
    assert.equal(
      claudeNativePackageName({ platform: "linux", arch: "x64" }),
      "@anthropic-ai/claude-agent-sdk-linux-x64",
    );
    assert.equal(
      claudeNativePackageName({ platform: "linux", arch: "arm64", musl: true }),
      "@anthropic-ai/claude-agent-sdk-linux-arm64-musl",
    );
  });

  it("does not invent a package for an unsupported target", () => {
    assert.equal(claudeNativePackageName({ platform: "freebsd", arch: "x64" }), null);
    assert.equal(claudeNativePackageName({ platform: "darwin", arch: "riscv64" }), null);
  });
});
