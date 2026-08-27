export function assembleTerminalHookContext(input: {
  preamble: string;
  workstreamContext: string | null;
  documentSections: string[];
  fallback: string;
  maximumBytes: number;
}): string {
  const context = [
    input.preamble,
    ...(input.workstreamContext === null ? [] : [input.workstreamContext]),
    input.documentSections.length === 0 ? input.fallback : input.documentSections.join("\n\n"),
  ].join("\n\n");
  if (Buffer.byteLength(context) > input.maximumBytes) {
    throw new Error("Prepared provider context exceeds the bounded output limit.");
  }
  return context;
}
