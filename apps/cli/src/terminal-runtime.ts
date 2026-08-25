import { readFile } from "node:fs/promises";

const testRuntime =
  "#!/usr/bin/env node\nprocess.stderr.write('terminal runtime fixture must not execute');\n";

export async function loadTerminalHookRuntime(): Promise<string> {
  if (process.env.NODE_ENV === "test") return testRuntime;
  return readFile(new URL("./terminal-hook.js", import.meta.url), "utf8");
}
