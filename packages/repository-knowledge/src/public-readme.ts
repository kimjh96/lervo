import { sha256, stableId } from "./integrity.js";

/** Public README coordinates that knowledge freshness checks preserve. */
export type PublicReadmeCoordinateKind =
  | "html_block"
  | "image"
  | "badge"
  | "link_target"
  | "anchor"
  | "fenced_command"
  | "package_name"
  | "installation_command"
  | "version_requirement"
  | "license_link"
  | "security_link"
  | "sponsor_link"
  | "table"
  | "accessibility_text";

export interface PublicReadmeCoordinate {
  coordinateId: string;
  kind: PublicReadmeCoordinateKind;
  value: string;
  valueHash: string;
}

function push(
  values: Array<{ kind: PublicReadmeCoordinateKind; value: string }>,
  kind: PublicReadmeCoordinateKind,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized.length > 0) values.push({ kind, value: normalized });
}

export function extractPublicReadmeCoordinates(content: string): PublicReadmeCoordinate[] {
  const values: Array<{ kind: PublicReadmeCoordinateKind; value: string }> = [];
  for (const match of content.matchAll(
    /<(?:div|p|table|picture|details|summary|a)\b[\s\S]*?<\/(?:div|p|table|picture|details|summary|a)>/giu,
  ))
    push(values, "html_block", match[0]);
  for (const match of content.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0];
    const source = /\bsrc=["']([^"']+)["']/iu.exec(tag)?.[1] ?? "";
    const alternative = /\balt=["']([^"']*)["']/iu.exec(tag)?.[1] ?? "";
    push(
      values,
      /badge/iu.test(source) || /badge/iu.test(alternative) ? "badge" : "image",
      `${alternative}\u0000${source}`,
    );
    push(values, "accessibility_text", alternative);
  }
  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    push(
      values,
      /badge/iu.test(match[1] ?? "") || /badge/iu.test(match[2] ?? "") ? "badge" : "image",
      `${match[1] ?? ""}\u0000${match[2] ?? ""}`,
    );
    push(values, "accessibility_text", match[1] ?? "");
  }
  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const label = match[1] ?? "";
    const target = match[2] ?? "";
    const lower = label.toLocaleLowerCase();
    push(
      values,
      lower.includes("license")
        ? "license_link"
        : lower.includes("security")
          ? "security_link"
          : /sponsor|fund/iu.test(lower)
            ? "sponsor_link"
            : "link_target",
      `${label}\u0000${target}`,
    );
  }
  for (const match of content.matchAll(/<(?:a\s+(?:id|name)|[^>]+\sid)=["']([^"']+)["'][^>]*>/giu))
    push(values, "anchor", match[1] ?? "");
  for (const match of content.matchAll(/```(?:bash|sh|shell|zsh|console)?\n([\s\S]*?)```/gu))
    push(values, "fenced_command", match[1] ?? "");
  for (const line of content.split("\n")) {
    if (/^\s*(?:npm|pnpm|yarn|bun|pipx?|cargo|go)\s+(?:install|add|get)\b/u.test(line))
      push(values, "installation_command", line);
    if (
      /\b(?:Node(?:\.js)?|Python|Go|Rust|Java)\s+(?:v?\d|version)|\brequires?\s+[^\n]*\d/u.test(
        line,
      )
    )
      push(values, "version_requirement", line);
    if (/^\s*\|.*\|\s*$/u.test(line)) push(values, "table", line);
  }
  for (const match of content.matchAll(
    /(?<![\w@/.-])(?:@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+\/[a-z0-9_.-]+)(?![\w/.-])/giu,
  ))
    push(values, "package_name", match[0]);
  const unique = [
    ...new Map(values.map((value) => [`${value.kind}\u0000${value.value}`, value])).values(),
  ].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value),
  );
  return unique.map((value) => ({
    ...value,
    valueHash: sha256(value.value),
    coordinateId: stableId("prc", value),
  }));
}
