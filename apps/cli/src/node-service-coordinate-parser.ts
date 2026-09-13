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
    } else if (character === "%" && value[index + 1] === "%") {
      decoded += "%";
      index += 1;
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
