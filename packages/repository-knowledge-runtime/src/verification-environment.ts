import { rmSync } from "node:fs";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import { runVerificationSuite } from "@lervo/verification";

import { toolEnvironment, type ToolEnvironmentDetection } from "./tool-environment.js";

/**
 * The environment verification commands run in: the owner's login-shell PATH (ADR-0536). Under the
 * service manager's minimal PATH a suite's own tools, such as `pnpm` for the isolated workspace,
 * were missing and every canonical integration failed. A suite's `lervo` is the CLI this process
 * runs (ADR-0655), never whichever `lervo` comes first on that PATH, such as a stale link a version
 * manager's directory holds.
 */
export async function verificationEnvironment(
  detect?: ToolEnvironmentDetection,
  cliEntry: string | undefined = process.env.LERVO_CLI_ENTRY,
): Promise<NodeJS.ProcessEnv> {
  const environment = (await toolEnvironment(detect)).environment;
  const shim = await runningCliDirectory(cliEntry);
  if (shim === null) return environment;
  return {
    ...environment,
    PATH: environment.PATH === undefined ? shim : `${shim}${delimiter}${environment.PATH}`,
  };
}

const shims = new Map<string, Promise<string | null>>();

/** Quotes a path for a POSIX shell script. */
function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A private directory holding `lervo`, a script that runs the CLI entry this process was started
 * from with this Node. Made once per process and removed when it exits; null without a usable
 * entry or on Windows, where the PATH lookup stands.
 */
function runningCliDirectory(cliEntry: string | undefined): Promise<string | null> {
  if (cliEntry === undefined || !isAbsolute(cliEntry) || process.platform === "win32")
    return Promise.resolve(null);
  const known = shims.get(cliEntry);
  if (known !== undefined) return known;
  const made = (async () => {
    if (!(await stat(cliEntry).catch(() => null))?.isFile()) return null;
    const directory = await mkdtemp(join(tmpdir(), "lervo-cli-"));
    process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
    const script = join(directory, "lervo");
    await writeFile(
      script,
      `#!/bin/sh\nexec ${shellQuoted(process.execPath)} ${shellQuoted(cliEntry)} "$@"\n`,
      { mode: 0o700 },
    );
    await chmod(script, 0o700);
    return directory;
  })().catch(() => null);
  shims.set(cliEntry, made);
  return made;
}

/**
 * The one way convergence runs a verification suite: always with the environment above. Every
 * convergence suite runs under the resident's service manager, and a call that forgot the
 * environment failed every canonical integration on `spawnSync pnpm ENOENT` (2026-11-23).
 */
export function runConvergenceVerificationSuite(
  input: Parameters<typeof runVerificationSuite>[0],
  environment: NodeJS.ProcessEnv,
): ReturnType<typeof runVerificationSuite> {
  return runVerificationSuite(input, { environment });
}
