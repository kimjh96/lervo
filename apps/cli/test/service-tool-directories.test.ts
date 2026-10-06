import { describe, expect, it } from "vitest";

import { resolveServiceToolDirectories } from "../src/service-tool-directories.js";

function host(files: string[]) {
  return async (path: string) => files.includes(path);
}

describe("service tool directories", () => {
  it("keeps the first directory per tool in PATH order and dedupes", async () => {
    expect(
      await resolveServiceToolDirectories({
        providers: ["codex", "codex"],
        searchPath: "/Users/o/.local/bin:/opt/homebrew/bin:/usr/bin:relative",
        isExecutable: host([
          "/opt/homebrew/bin/codex",
          "/Users/o/.local/bin/codex",
          "/opt/homebrew/bin/gh",
          "/usr/bin/git",
        ]),
      }),
    ).toEqual({
      directories: ["/Users/o/.local/bin", "/usr/bin", "/opt/homebrew/bin"],
      missing: [],
      missingOptional: [],
    });
  });

  it("reports a missing provider or git as required and gh as optional", async () => {
    expect(
      await resolveServiceToolDirectories({
        providers: ["claude"],
        searchPath: "/usr/bin",
        isExecutable: host([]),
      }),
    ).toEqual({ directories: [], missing: ["claude", "git"], missingOptional: ["gh"] });
  });
});
