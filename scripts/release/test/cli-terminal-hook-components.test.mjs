import { expect, it } from "vitest";
import { terminalHookComponents } from "../lib/cli-terminal-hook-components.mjs";

it("binds both terminal artifacts in the SBOM and retains legacy readers", () => {
  expect(terminalHookComponents({ schemaVersion: 9 })).toEqual([]);
  const manifest = {
    schemaVersion: 10,
    archive: {
      files: [
        { path: "dist/terminal-hook.js", sha256: `sha256:${"a".repeat(64)}` },
        { path: "dist/terminal-hook-launcher.mjs", sha256: `sha256:${"b".repeat(64)}` },
      ],
    },
  };
  expect(terminalHookComponents(manifest)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "dist/terminal-hook.js",
        hashes: [{ alg: "SHA-256", content: "a".repeat(64) }],
      }),
      expect.objectContaining({
        name: "dist/terminal-hook-launcher.mjs",
        hashes: [{ alg: "SHA-256", content: "b".repeat(64) }],
      }),
    ]),
  );
  manifest.archive.files.pop();
  expect(() => terminalHookComponents(manifest)).toThrow("release_terminal_hook_component_missing");
});
