import { basename } from "node:path";

export interface RepositoryInstructionRouteInput {
  instructions: Array<{ path: string; instructionPaths: string[] }>;
  skills: Array<{ path: string }>;
}

export function repositoryInstructionRouteBlock(input: RepositoryInstructionRouteInput): string {
  const lines = [
    "<!-- lervo:begin block=repository_instruction_routes schema=1 -->",
    "## Repository instruction routes",
    "",
    "- Read the verified current state with `lervo workstream current --context` before continuing repository work.",
    "- Before completing a terminal turn, create the first bounded checkpoint with `lervo workstream start` or advance the existing snapshot with `lervo workstream update`; perform this agent bookkeeping without asking the user to run it.",
    "- Translate explicit natural-language requests to hire, assign, inspect, resolve, hand off, or retire repository agents into `lervo agent`, `lervo assignment`, and workstream operations yourself; when authority or scope is ambiguous, record one bounded pending decision instead of guessing or asking for a bookkeeping command.",
    "- Resolve roles with `lervo role list|show|validate`; treat the six built-ins as templates, author a lazy `.lervo/roles/<role-id>.json` source when a requested repository role does not exist, and never bypass version, hash, capability, verification, or ancestry validation.",
    "- Register every subagent with its parent and apply the same durable identity, scoped lease, path-conflict, evidence, verification, and finalization contracts used for root agents.",
  ];
  for (const item of [...input.instructions].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const scope =
      item.instructionPaths.length === 0
        ? "For all repository work"
        : `For paths matching ${item.instructionPaths.map((path) => `\`${path}\``).join(", ")}`;
    lines.push(`- ${scope}, read [${basename(item.path, ".md")}](${item.path}).`);
  }
  for (const item of [...input.skills].sort((left, right) => left.path.localeCompare(right.path))) {
    const skillName = item.path.split("/").at(-2)!;
    lines.push(
      `- When a task matches the \`${skillName}\` skill, read [its SKILL.md](${item.path}) before acting.`,
    );
  }
  lines.push("<!-- lervo:end block=repository_instruction_routes -->", "");
  return lines.join("\n");
}
