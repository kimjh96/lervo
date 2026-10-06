import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const KNOWLEDGE_HOST_SERVICE_CONFIG_PATH = "knowledge-host/config.json";
const MAXIMUM_CONFIG_BYTES = 16 * 1024;

/**
 * ADR-0470 host resident service configuration. Lervo writes it once and never rewrites an
 * existing valid file. Tool directories are not here: they are rendered into the service
 * definition's PATH, so the reviewed plan hash binds them.
 */
export interface KnowledgeHostServiceConfig {
  schemaVersion: 1;
  /** The user state directory whose registries and policy the resident reads. */
  userStateDirectory: string;
  /** Fallback provider when neither a delegation nor the policy template names one. */
  provider: "codex" | "claude" | null;
}

function safeAbsolute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isAbsolute(value) &&
    resolve(value) === value &&
    !/[\0\r\n]/u.test(value)
  );
}

/** Pure: the validated configuration, or null when any field fails its contract. */
export function parseKnowledgeHostServiceConfig(value: unknown): KnowledgeHostServiceConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const config = value as Record<string, unknown>;
  if (
    config.schemaVersion !== 1 ||
    !safeAbsolute(config.userStateDirectory) ||
    (config.provider !== null && config.provider !== "codex" && config.provider !== "claude") ||
    Object.keys(config).length !== 3
  )
    return null;
  return {
    schemaVersion: 1,
    userStateDirectory: config.userStateDirectory,
    provider: config.provider,
  };
}

export type KnowledgeHostServiceConfigReading =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "loaded"; config: KnowledgeHostServiceConfig };

export async function readKnowledgeHostServiceConfig(
  path: string,
): Promise<KnowledgeHostServiceConfigReading> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAXIMUM_CONFIG_BYTES)
      return { status: "invalid" };
    const config = parseKnowledgeHostServiceConfig(JSON.parse(await readFile(path, "utf8")));
    return config === null ? { status: "invalid" } : { status: "loaded", config };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "absent" }
      : { status: "invalid" };
  }
}

/** Creates the configuration only when absent; false means another writer created it first. */
export async function createKnowledgeHostServiceConfig(
  path: string,
  config: KnowledgeHostServiceConfig,
): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  await chmod(path, 0o600);
  return true;
}

/** Applies a loaded configuration to this process before any resident starts. */
export function applyKnowledgeHostServiceEnvironment(
  config: KnowledgeHostServiceConfig,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  environment.LERVO_USER_STATE_DIRECTORY = config.userStateDirectory;
}
