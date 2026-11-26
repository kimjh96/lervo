import { dirname, resolve } from "node:path";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";
import { parseSupervisionStartupConfiguration } from "./supervision-startup-config.js";

/** Local execution configuration does not create authority or configure a transport. */
export function parseLocalSupervisionConfig(value: unknown, baseDirectory: string) {
  const source = configRecord(value, "Local supervision config");
  exactConfigKeys(
    source,
    ["schemaVersion", "repositoryRoot", "outcomeSupervision"],
    "Local supervision config",
  );
  if (source.schemaVersion !== 1)
    throw new NodeRuntimeError("invalid_config", "Local supervision schemaVersion must be 1.");
  const configuration = parseSupervisionStartupConfiguration(source.outcomeSupervision);
  if (configuration.resultOrigin !== undefined)
    throw new NodeRuntimeError(
      "invalid_config",
      "Local supervision requires a separate configured transport for result delivery.",
    );
  return {
    repositoryRoot: resolve(baseDirectory, configText(source.repositoryRoot, "repositoryRoot")),
    configuration,
  };
}

export async function loadLocalSupervisionConfig(path: string) {
  let text: string;
  try {
    text = await readOwnerOnlyText(path, 1_048_576);
  } catch (error) {
    throw new NodeRuntimeError("unsafe_runtime_file", "Cannot safely read supervision config.", {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "Supervision config must be valid JSON.", {
      cause: error,
    });
  }
  return parseLocalSupervisionConfig(value, dirname(path));
}
