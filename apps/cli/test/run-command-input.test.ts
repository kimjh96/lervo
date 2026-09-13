import { describe, expect, it } from "vitest";
import { runCli } from "../src/main.js";
import type { ManagedRunRequest } from "../src/managed-run.js";

describe("managed command request transport", () => {
  it("passes private standard input and every explicit path to managed execution", async () => {
    let request: ManagedRunRequest | undefined;
    const key = `sha256:${"a".repeat(64)}`;
    await runCli(
      [
        "run",
        "--provider",
        "codex",
        "--path",
        "src/a.ts",
        "--path",
        "src/b.ts",
        "--verification",
        "project.default",
        "--execution-key",
        key,
        "--stdin",
        "--json",
      ],
      {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: () => undefined,
        stdin: async () => "Private request with $(literal) syntax.\n",
      },
      {
        executeManagedRun: async (input) => {
          request = input;
          throw new Error("fixture stop");
        },
      },
    );
    expect(request).toMatchObject({
      executionKey: key,
      expectedPaths: ["src/a.ts", "src/b.ts"],
      instructions: "Private request with $(literal) syntax.",
    });
    expect(request?.expectedPath).toBeUndefined();
  });

  it.each(["ambiguous", "unavailable", "oversized"])(
    "rejects %s input before execution",
    async (kind) => {
      let invoked = false;
      const result = await runCli(
        [
          "run",
          "--provider",
          "codex",
          "--path",
          "src/a.ts",
          "--verification",
          "project.default",
          "--stdin",
          ...(kind === "ambiguous" ? ["extra request"] : []),
        ],
        {
          cwd: process.cwd(),
          stdout: () => undefined,
          stderr: () => undefined,
          ...(kind === "unavailable" ? {} : { stdin: async () => "a".repeat(131073) }),
        },
        {
          executeManagedRun: async () => {
            invoked = true;
            throw new Error("must not execute");
          },
        },
      );
      expect(result).toBe(1);
      expect(invoked).toBe(false);
    },
  );
});
