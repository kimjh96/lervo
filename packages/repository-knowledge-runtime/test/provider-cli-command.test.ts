import { expect, it } from "vitest";
import { runProviderCliCommand } from "../src/provider-cli-command.js";

it("bounds login-shell lifetime even if it spawns a child", async () => {
  expect(await runProviderCliCommand("/bin/sh", ["-c", "sleep 60 & wait"], 25)).toMatchObject({
    status: "timed_out",
  });
});
it("caps shell and version output and ignores failed commands", async () => {
  expect(
    await runProviderCliCommand(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(100000))"],
      1000,
    ),
  ).toMatchObject({ status: "failed" });
  expect(
    await runProviderCliCommand(
      "/nonexistent/lervo-shell",
      ["-lc", "command -v codex claude"],
      1000,
    ),
  ).toMatchObject({ status: "failed" });
});
