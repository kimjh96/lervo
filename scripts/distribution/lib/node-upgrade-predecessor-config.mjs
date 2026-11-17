import { isAbsolute, resolve } from "node:path";

function decodeSystemd(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      const next = value[index + 1];
      if (next !== "\\" && next !== '"') return null;
      decoded += next;
      index += 1;
    } else if ((character === "%" || character === "$") && value[index + 1] === character) {
      decoded += character;
      index += 1;
    } else if (character === "%" || character === "$") {
      // systemd expands a lone specifier or variable, so the literal path is unknown.
      return null;
    } else decoded += character;
  }
  return decoded;
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** An upgrade cannot lock a replacement config in place of the running Node's config. */
export function nodeUpgradePredecessorConfig(manager, bytes) {
  const content = bytes.toString("utf8");
  let path = null;
  if (manager === "systemd") {
    const lines = content.split("\n").filter((line) => line.startsWith("ExecStart="));
    if (lines.length !== 1) return null;
    const match =
      /^ExecStart="(?:[^"\\]|\\.)*"(?: "(?:[^"\\]|\\.)*")? --config "((?:[^"\\]|\\.)*)"$/u.exec(
        lines[0],
      );
    if (match === null) return null;
    path = decodeSystemd(match[1]);
  } else if (manager === "launchd") {
    if ((content.match(/<key>ProgramArguments<\/key>/gu) ?? []).length !== 1) return null;
    const match =
      /<key>ProgramArguments<\/key>\s*<array>\s*(?:<string>[^<]+<\/string>\s*){1,2}<string>--config<\/string>\s*<string>([^<]+)<\/string>\s*<\/array>/u.exec(
        content,
      );
    if (match === null) return null;
    path = decodeXml(match[1]);
  }
  return typeof path === "string" && isAbsolute(path) && !/[\0\r\n]/u.test(path)
    ? resolve(path)
    : null;
}
