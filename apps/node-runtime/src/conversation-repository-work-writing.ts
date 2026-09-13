const MAXIMUM_DISCORD_CHARACTERS = 1_950;

export function executionInstructions(input: {
  request: string;
  priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  durableResults: readonly string[];
  worker: { displayName: string; roleId: string } | null;
  externalEffectsAuthorized: boolean;
}): string {
  const history = input.priorTurns
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.text.slice(0, 2_048)}`)
    .join("\n");
  const durableHistory = input.durableResults
    .slice(0, 8)
    .reverse()
    .map((result) => result.slice(0, 1_024))
    .join("\n---\n");
  return [
    "You are operating a real repository work session initiated from a conversation surface.",
    input.worker === null
      ? "Act as the repository agent who owns this conversation."
      : `Act as the hired agent ${input.worker.displayName} with repository role ${input.worker.roleId}.`,
    "Use repository tools now. Inspect the repository, perform the requested work, and verify it in proportion to risk.",
    "Do not merely promise work, create a queue, or ask the user to repeat information already present below.",
    "If repository bytes change, finish the repository's native AGENTS.md completion lifecycle before replying: advance the current workstream and run the knowledge and verification checks required for the touched scope.",
    "Do not create or require an unmanaged terminal declaration: the Node records managed conversation-work completion against the exact final revision after provider exit.",
    "A changed worktree without its checkpoint, valid current-scope knowledge, required verification, and replica parity is a failed turn and must not be reported as complete. Pre-existing unrelated normalization debt is not a blocker when knowledge lint remains valid; do not misreport it as caused by this turn.",
    input.externalEffectsAuthorized
      ? "The authenticated requester has configured external-effect request authority. Perform only a commit, repository-remote creation, or push explicitly requested in Current request; observe the external state before execution, execute once, and verify it independently afterward. On an uncertain result, inspect the remote instead of blindly retrying. Deployment, broad deletion, unrelated publication, and secret disclosure remain prohibited."
      : "Do not commit, push, publish, deploy, delete broad paths, or expose secrets.",
    "If the request is research or diagnosis, investigate with tools and report concrete evidence without changing files unless needed.",
    "Answer the current request concisely in the conversation language, leading with the outcome. Include paths, checks, or limitations only when they help answer that request or explain its completion. Base completion claims on observed results; explain a failed save or unverified result when it affects the requested outcome.",
    "Keep the final response below 1,500 characters. Do not append a fixed change, checkpoint, lint, or telemetry summary. Show a short code excerpt only when the user requested code.",
    history.length === 0
      ? "No prior conversation turns were available."
      : `Recent turns:\n${history}`,
    durableHistory.length === 0
      ? "No earlier durable work result was available for this worker."
      : `Earlier durable work results for this worker:\n${durableHistory}`,
    `Current request:\n${input.request}`,
  ].join("\n\n");
}

export function fitDiscord(content: string): string {
  const characters = [...content.trim().replaceAll("—", "-")];
  if (characters.length <= MAXIMUM_DISCORD_CHARACTERS) return characters.join("");
  return `${characters.slice(0, MAXIMUM_DISCORD_CHARACTERS - 42).join("")}\n\n…결과가 길어 일부를 생략했습니다.`;
}
