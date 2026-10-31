type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;

/** Native entries only. Tool output and strings mentioning Skill are never invocation evidence. */
export function transcriptSkillIdentifiers(provider: "claude" | "codex", entry: unknown): string[] {
  const record = object(entry);
  if (provider === "claude") {
    if (record?.type !== "assistant") return [];
    const content = object(record.message)?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((value) => {
      const block = object(value);
      const skill = object(block?.input)?.skill;
      return block?.type === "tool_use" && block.name === "Skill" && typeof skill === "string"
        ? [skill]
        : [];
    });
  }
  if (record?.type !== "response_item") return [];
  const call = object(record.payload);
  if (call?.type !== "function_call" || call.name !== "Skill" || typeof call.arguments !== "string")
    return [];
  const skill = object(JSON.parse(call.arguments))?.skill;
  return typeof skill === "string" ? [skill] : [];
}
