import { redactDiagnosticText } from "@lervo/event-contract";
import { secretCandidatePath } from "./repository-source-classification.js";
import { safePracticePath } from "./practice-contract.js";

/** Reuse scanner path exclusions and the shared credential classifier before retaining evidence. */
export function practicePublicPath(path: string): boolean {
  return (
    safePracticePath(path) &&
    !secretCandidatePath(path) &&
    !/(?:^|\/)(?:\.aws|\.ssh|\.lervo|private)(?:\/|$)/u.test(path)
  );
}

export function sanitizePracticeText(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    let changed = false;
    const strip = (item: unknown): unknown => {
      if (typeof item === "string") {
        const clean = sanitizePracticeText(item);
        changed ||= clean !== item;
        return clean;
      }
      if (Array.isArray(item)) return item.map(strip);
      if (item !== null && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).flatMap(([key, value]) => {
            if (
              /^(?:password|token|secret|api[_-]?key|authorization|cookie|private[_-]?key)$/iu.test(
                key,
              )
            ) {
              changed = true;
              return [];
            }
            return [[key, strip(value)]];
          }),
        );
      return item;
    };
    const clean = strip(value);
    return changed ? JSON.stringify(clean) : text;
  } catch {
    // Fragments and fenced JSON cannot safely retain a multiline secret value.
    const diagnostic = text
      .replace(/\\u([a-f0-9]{4})/giu, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\(["'\\])/gu, "$1");
    if (
      /["'](?:password|token|secret|api[_-]?key|authorization|cookie|private[_-]?key)["']\s*:/iu.test(
        diagnostic,
      )
    )
      return "";
  }
  const withoutKeys = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
    "",
  );
  return withoutKeys
    .split(/\r?\n/u)
    .filter((line) => {
      const classified = redactDiagnosticText(line, Math.max(16, line.length + 16));
      return (
        !classified.includes("[redacted") &&
        !/\b(?:password|token|secret|api[_-]?key|authorization|cookie|private[_-]?key)\b\s*[:=]/iu.test(
          line,
        ) &&
        !/(?:\/Users\/|\/home\/|[A-Z]:\\)/u.test(line)
      );
    })
    .join("\n");
}
