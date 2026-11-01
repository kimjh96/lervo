export interface RepositoryInstructionRouteInput {
  instructions: Array<{ path: string; instructionPaths: string[] }>;
  skills: Array<{ path: string }>;
}

export function repositoryInstructionRouteBlock(_input: RepositoryInstructionRouteInput): string {
  return [
    "<!-- lervo:begin block=repository_instruction_routes schema=2 -->",
    "## Repository instruction bootstrap",
    "",
    "- Read the verified current state with `lervo workstream current --context` before continuing repository work.",
    '- Before changing repository bytes, resolve applicable canonical instructions and portable skills with `lervo knowledge query "<task purpose and target paths>"`; read the returned sources before acting. The knowledge registry is authoritative, so do not grow this entrypoint with one route per rule or skill.',
    "- Before completing a terminal turn, create the first bounded checkpoint with `lervo workstream start` or advance the existing snapshot with `lervo workstream update`; perform this agent bookkeeping without asking the user to run it.",
    "- Translate explicit natural-language requests to hire, assign, inspect, resolve, hand off, or retire repository agents into `lervo agent`, `lervo assignment`, and workstream operations yourself; when authority or scope is ambiguous, record one bounded pending decision instead of guessing or asking for a bookkeeping command.",
    "- Resolve roles with `lervo role list|show|validate`; treat the six built-ins as templates, author a lazy `.lervo/roles/<role-id>.json` source when a requested repository role does not exist, and never bypass version, hash, capability, verification, or ancestry validation.",
    "- Register every subagent with its parent and apply the same durable identity, scoped lease, path-conflict, evidence, verification, and finalization contracts used for root agents.",
    "- Never record owner rules, corrections, or decisions in provider-private memory. Lervo captures them from the conversation and applies owner-stated rules automatically; to record one explicitly, use `lervo knowledge instruction intake`. Follow every applied rule under `docs/instructions/generated/`.",
    "<!-- lervo:end block=repository_instruction_routes -->",
    "",
  ].join("\n");
}
