import { parse } from "yaml";

/**
 * Front matter a repository document uses to declare its own placement and instruction scope.
 * Reading it is pure parsing; deciding what the declaration means stays with the layout.
 */
export function explicitDocumentPlacement(
  content: string,
):
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "present"; routeId?: string; roleId?: string; filename?: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { state: "absent" };
  const boundary = /\r?\n---\r?\n/gu;
  boundary.lastIndex = content.indexOf("\n") + 1;
  const match = boundary.exec(content);
  if (match === null || match.index > 8192) return { state: "absent" };
  let value: unknown;
  try {
    value = parse(content.slice(content.indexOf("\n") + 1, match.index));
  } catch {
    return { state: "invalid" };
  }
  const document = (value as { lervo?: { document?: unknown } } | null)?.lervo?.document as
    { route?: unknown; role?: unknown } | undefined;
  if (document === undefined) return { state: "absent" };
  // Exactly one of a configured route or a repository document role.
  if (
    document === null ||
    typeof document !== "object" ||
    (typeof document.route === "string") === (typeof document.role === "string") ||
    (document.route !== undefined && typeof document.route !== "string") ||
    (document.role !== undefined && typeof document.role !== "string")
  )
    return { state: "invalid" };
  const filename = (document as { filename?: unknown }).filename;
  if (
    filename !== undefined &&
    (typeof filename !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.mdx?$/u.test(filename))
  )
    return { state: "invalid" };
  if (typeof document.role === "string")
    return filename === undefined
      ? { state: "present", roleId: document.role }
      : { state: "invalid" };
  return {
    state: "present",
    routeId: document.route as string,
    ...(filename === undefined ? {} : { filename }),
  };
}

function frontmatterValue(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return null;
  const match = /\r?\n---\r?\n/gu.exec(content.slice(content.indexOf("\n")));
  if (match === null || match.index > 8192) return null;
  try {
    const value = parse(
      content.slice(content.indexOf("\n") + 1, content.indexOf("\n") + match.index + 1),
    );
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function instructionPaths(content: string): string[] {
  const value = frontmatterValue(content);
  const raw = value?.paths ?? value?.globs;
  const splitGlobs = (input: string): string[] => {
    const output: string[] = [];
    let start = 0;
    let braces = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === "{") braces += 1;
      else if (input[index] === "}") braces = Math.max(0, braces - 1);
      else if (input[index] === "," && braces === 0) {
        output.push(input.slice(start, index));
        start = index + 1;
      }
    }
    output.push(input.slice(start));
    return output;
  };
  const paths = Array.isArray(raw) ? raw : typeof raw === "string" ? splitGlobs(raw) : [];
  return [
    ...new Set(
      paths
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function repositoryInstructionPaths(content: string): string[] {
  return instructionPaths(content);
}
