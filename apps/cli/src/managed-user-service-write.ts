import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export interface ManagedServiceStatus {
  managerAvailable: boolean;
  installed: boolean;
  enabled: boolean | null;
  active: boolean;
  /** ADR-0573: the running process id the status action reports; null when none runs. */
  processId?: number | null;
  change?: string;
}

/**
 * Installs, transactionally replaces, or restarts one Lervo user service through the
 * release-tested service manager (ADR-0470, ADR-0483, ADR-0573). An upgrade passes the installed
 * bytes as the exact predecessor, so the manager restores them if the new service does not stay
 * active; a restart keeps the exact installed definition. Returns the manager's observed status;
 * the caller decides what an inactive result means.
 */
export async function writeManagedUserService(input: {
  manage(args: string[], options: Record<string, unknown>): Promise<ManagedServiceStatus>;
  options: { homeDirectory: string; platform: NodeJS.Platform; uid: number | null };
  manager: "launchd" | "systemd";
  runtime: string;
  action: "install" | "activate" | "upgrade" | "restart";
  definition: string;
  installed: Buffer | null;
  coordinates: {
    executable: string;
    nodeExecutable: string;
    configPath: string;
    pathDirectories: string[];
    /** A launchd output path; the manager re-renders the definition with it. */
    logFile?: string;
  };
}): Promise<ManagedServiceStatus> {
  const directory = await mkdtemp(resolve(tmpdir(), `lervo-${input.runtime}-service-`));
  try {
    const definitionPath = resolve(directory, "service-definition");
    await writeFile(definitionPath, input.definition, { mode: 0o600, flag: "wx" });
    await chmod(definitionPath, 0o600);
    const previous: string[] = [];
    if (input.action === "upgrade") {
      const previousPath = resolve(directory, "previous-service-definition");
      await writeFile(previousPath, input.installed!, { mode: 0o600, flag: "wx" });
      await chmod(previousPath, 0o600);
      previous.push("--previous-definition", previousPath);
    }
    const { coordinates } = input;
    return await input.manage(
      [
        "--action",
        input.action === "activate" ? "install" : input.action,
        "--manager",
        input.manager,
        "--runtime",
        input.runtime,
        "--definition",
        definitionPath,
        ...previous,
        "--executable",
        coordinates.executable,
        "--node-executable",
        coordinates.nodeExecutable,
        ...(coordinates.pathDirectories.length === 0
          ? []
          : ["--path-directories", coordinates.pathDirectories.join(":")]),
        ...(coordinates.logFile === undefined ? [] : ["--log-file", coordinates.logFile]),
        "--config",
        coordinates.configPath,
        "--write",
      ],
      input.options,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
