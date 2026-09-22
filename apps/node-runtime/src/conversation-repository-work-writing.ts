const MAXIMUM_DISCORD_CHARACTERS = 1_950;

export function executionInstructions(input: {
  request: string;
  priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  durableResults: readonly string[];
  worker: { displayName: string; roleId: string } | null;
  externalEffectsAuthorized: boolean;
  finalizationStartsAt: string;
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
    "If repository bytes change, create or advance a bounded active workstream checkpoint immediately after the first material edit; do not postpone the first checkpoint until all implementation and verification are finished.",
    `At ${input.finalizationStartsAt}, stop new implementation and optional checks. Use the remaining execution reserve to inspect the exact current state, advance the workstream again when later edits changed it, run the bounded required completion checks, and answer. If the full scope is not complete, preserve an accurate active checkpoint and report the bounded remainder instead of working until the provider is killed.`,
    "Before replying, finish the provider-observable AGENTS.md lifecycle for the exact current state, including the workstream, knowledge, and verification checks required for the touched scope.",
    "Do not create or require an unmanaged terminal declaration. Repository-replica freshness and the managed conversation-work completion event are host-owned post-exit gates; the Node verifies them after this process exits and refuses publication when they fail.",
    "Do not tell the user that final completion is withheld, pending, or unconfirmed because replica parity or a managed completion event is not yet visible inside this provider process. Report the requested work and provider-observed verification accurately; the host owns that final publication decision.",
    "A changed worktree without its checkpoint, valid current-scope knowledge, and required provider-observable verification is a failed turn and must not be reported as complete. Pre-existing unrelated normalization debt is not a blocker when knowledge lint remains valid; do not misreport it as caused by this turn.",
    input.externalEffectsAuthorized
      ? "The authenticated requester has configured external-effect request authority. Perform only a commit, repository-remote creation, push, or deployment explicitly requested in Current request. For deployment, identify the exact target, preserve a rollback, check current runtime state and authority, and verify the installed result. Do not widen risk limits, reset a kill switch, or alter credentials without a separate explicit request. Observe external state before execution, execute once, and verify it independently afterward. On an uncertain result, inspect the target instead of blindly retrying. Broad deletion, unrelated publication, and secret disclosure remain prohibited."
      : "Do not commit, push, publish, deploy, delete broad paths, or expose secrets.",
    "If the request is research or diagnosis, investigate with tools and report concrete evidence without changing files unless needed.",
    "Treat provider-native tools, plugins, and connectors as turn-local capabilities. A tool missing from one provider does not prove that an integration is uninstalled, and a visible tool does not prove that its account or project scope is authorized. Claim connected or installed only from a successful current authenticated operation, report authorization failures exactly, and never claim that an internal suggestion, card, widget, or installation screen was shown to the user unless the external surface delivery was independently verified.",
    "When inspecting Node deployment configuration, use the repository parser or account for both legacy discordConversation and plural discordConversations forms. A repository-scoped agent listing is not an organization-wide workforce inventory. State the scope of every count or absence claim.",
    "Keep request, start, effect, completion, failure, and publication timestamps distinct. A generic historical failure code does not establish a common cause, and attention_required proves missing verified receipt rather than definite platform absence.",
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
