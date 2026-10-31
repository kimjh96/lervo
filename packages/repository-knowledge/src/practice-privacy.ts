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
  const withoutKeys = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
    "",
  );
  return withoutKeys
    .split(/\r?\n/u)
    .filter((line) => {
      const classified = redactDiagnosticText(line, Math.max(16, line.length + 16));
      return !classified.includes("[redacted") && !/(?:\/Users\/|\/home\/|[A-Z]:\\)/u.test(line);
    })
    .join("\n");
}
