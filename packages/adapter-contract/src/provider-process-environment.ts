import { dirname, delimiter, resolve } from "node:path";

/**
 * Preserve the host environment while making the running Lervo Node executable
 * available to provider launchers whose configured entrypoint uses `env node`.
 */
export function createProviderProcessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeExecutable: string = process.execPath,
): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const pathKeys = Object.keys(result).filter((key) => key.toLowerCase() === "path");
  const pathKey = pathKeys[0] ?? "PATH";
  for (const duplicate of pathKeys.slice(1)) delete result[duplicate];

  const runtimeDirectory = dirname(resolve(runtimeExecutable));
  const existing = (result[pathKey] ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0 && resolve(entry) !== runtimeDirectory);
  result[pathKey] = [runtimeDirectory, ...existing].join(delimiter);
  return result;
}
