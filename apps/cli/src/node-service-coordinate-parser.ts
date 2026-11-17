import { isAbsolute } from "node:path";

export interface ParsedNodeServiceCoordinates {
  executable: string;
  config: string;
  nodeExecutable?: string;
}

function coordinates(
  executable: string,
  config: string,
  nodeExecutable?: string,
): ParsedNodeServiceCoordinates | null {
  if (
    [executable, config, ...(nodeExecutable === undefined ? [] : [nodeExecutable])].some(
      (path) => !isAbsolute(path) || /[\0\r\n]/u.test(path),
    )
  )
    return null;
  return { executable, config, ...(nodeExecutable === undefined ? {} : { nodeExecutable }) };
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function decodeSystemd(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      const next = value[index + 1];
      if (next !== "\\" && next !== '"') return null;
      decoded += next;
      index += 1;
    } else if ((character === "%" || character === "$") && value[index + 1] === character) {
      decoded += character;
      index += 1;
    } else if (character === "%" || character === "$") {
      // A lone specifier or variable is expanded by systemd, so the literal path is unknown.
      return null;
    } else decoded += character;
  }
  return decoded;
}

export function parseNodeServiceCoordinates(
  manager: "systemd" | "launchd",
  content: string,
): ParsedNodeServiceCoordinates | null {
  if (manager === "launchd") {
    if ((content.match(/<key>ProgramArguments<\/key>/gu) ?? []).length !== 1) return null;
    const match =
      /<key>ProgramArguments<\/key>\s*<array>\s*(?:<string>([^<]+)<\/string>\s*)?<string>([^<]+)<\/string>\s*<string>--config<\/string>\s*<string>([^<]+)<\/string>\s*<\/array>/u.exec(
        content,
      );
    return match === null
      ? null
      : coordinates(
          decodeXml(match[2]!),
          decodeXml(match[3]!),
          match[1] === undefined ? undefined : decodeXml(match[1]),
        );
  }
  const lines = content.split("\n").filter((item) => item.startsWith("ExecStart="));
  if (lines.length !== 1) return null;
  const line = lines[0];
  const match =
    /^ExecStart="((?:[^"\\]|\\.)*)"(?: "((?:[^"\\]|\\.)*)")? --config "((?:[^"\\]|\\.)*)"$/u.exec(
      line ?? "",
    );
  if (match === null) return null;
  const executable = decodeSystemd(match[2] ?? match[1]!);
  const config = decodeSystemd(match[3]!);
  const nodeExecutable = match[2] === undefined ? undefined : decodeSystemd(match[1]!);
  return executable === null || config === null || nodeExecutable === null
    ? null
    : coordinates(executable, config, nodeExecutable);
}

/**
 * The Node executable a runtime service starts: its first program argument, whatever follows.
 * ADR-0577 compares an installed definition rendered with another Node through it.
 */
export function parseServiceNodeExecutable(
  manager: "systemd" | "launchd",
  content: string,
): string | null {
  let node: string | null;
  if (manager === "launchd") {
    if ((content.match(/<key>ProgramArguments<\/key>/gu) ?? []).length !== 1) return null;
    const match = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/u.exec(
      content,
    );
    node = match === null ? null : decodeXml(match[1]!);
  } else {
    const lines = content.split("\n").filter((item) => item.startsWith("ExecStart="));
    if (lines.length !== 1) return null;
    const match = /^ExecStart="((?:[^"\\]|\\.)*)" /u.exec(lines[0]!);
    node = match === null ? null : decodeSystemd(match[1]!);
  }
  return node !== null && isAbsolute(node) && !/[\0\r\n]/u.test(node) ? node : null;
}

/**
 * Every program argument of a rendered Lervo service, decoded: the quoted paths and the bare
 * subcommand words a systemd `ExecStart` holds, or each `<string>` of the launchd
 * `ProgramArguments` array. Null when the definition does not have exactly that shape.
 */
export function parseServiceProgramArguments(
  manager: "systemd" | "launchd",
  content: string,
): string[] | null {
  if (manager === "launchd") {
    if ((content.match(/<key>ProgramArguments<\/key>/gu) ?? []).length !== 1) return null;
    const array =
      /<key>ProgramArguments<\/key>\s*<array>((?:\s*<string>[^<]*<\/string>)+)\s*<\/array>/u.exec(
        content,
      );
    if (array === null) return null;
    return [...array[1]!.matchAll(/<string>([^<]*)<\/string>/gu)].map((match) =>
      decodeXml(match[1]!),
    );
  }
  const lines = content.split("\n").filter((item) => item.startsWith("ExecStart="));
  if (lines.length !== 1) return null;
  const tokens: string[] = [];
  const token = /(?:"((?:[^"\\]|\\.)*)"|([^\s"\\]+))(?: |$)/uy;
  const line = lines[0]!.slice("ExecStart=".length);
  while (token.lastIndex < line.length) {
    const start = token.lastIndex;
    const match = token.exec(line);
    if (match === null || match.index !== start) return null;
    const value = match[1] === undefined ? match[2]! : decodeSystemd(match[1]);
    if (value === null) return null;
    tokens.push(value);
  }
  return tokens.length === 0 || line.endsWith(" ") ? null : tokens;
}

/**
 * The configuration path any rendered Lervo service passes as its last two arguments,
 * `--config <absolute-path>`, after a Node executable, a launcher, and any subcommand words.
 */
export function parseServiceConfigPath(
  manager: "systemd" | "launchd",
  content: string,
): string | null {
  const values = parseServiceProgramArguments(manager, content);
  if (values === null || values.filter((value) => value === "--config").length !== 1) return null;
  const config = values.at(-1)!;
  return values.at(-2) === "--config" && isAbsolute(config) && !/[\0\r\n]/u.test(config)
    ? config
    : null;
}
