import { dirname } from "node:path";
import { vi } from "vitest";

import { runProviderCliCommand } from "../src/provider-cli-command.js";
import * as detection from "../src/provider-cli-detection.js";

/**
 * Confines provider CLI discovery to `home` so a failing fixture executable can never fall back
 * to a `claude` or `codex` installed on the developer's machine (Homebrew, ~/.local/bin, or the
 * login shell PATH). The login-shell lookup reports a PATH that still reaches `node` for fixture
 * shebangs but resolves no provider names; every other command runs for real.
 */
export function isolateProviderCliDetection(home: string) {
  return vi.spyOn(detection, "defaultProviderCliDetectionPorts").mockReturnValue({
    home,
    shell: process.execPath,
    prefixes: [],
    command: async (executable, args, timeoutMs, environment) => {
      if (args[0] === "-lc")
        return { status: "completed", stdout: `\0${dirname(process.execPath)}:/usr/bin:/bin\0` };
      return runProviderCliCommand(executable, args, timeoutMs, environment);
    },
  });
}
