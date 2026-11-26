// Claude Code's questions with choices, through its stream's control requests (Lervo ADE sessions,
// "Questions").
import type { HostedDecodedContent, HostedQuestion } from "@lervo/adapter-contract";

/**
 * The most questions, options, and characters one request may show, so its choices stay well
 * within the session host's bound on an item.
 */
const MAXIMUM_QUESTIONS = 4;
const MAXIMUM_OPTIONS = 8;
const MAXIMUM_QUESTION = 512;
const MAXIMUM_HEADER = 64;
const MAXIMUM_LABEL = 128;
const MAXIMUM_DESCRIPTION = 256;
const REPLIED_IN_PROSE =
  "The person replied in the conversation instead of choosing; their next message answers.";

/** The identifiers the conversation carries (`identifierSchema`). */
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const ASK_IN_PROSE =
  "Ask the person in your message instead; they will answer in the conversation.";

type Line = Record<string, unknown>;

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function questionsOf(input: unknown): HostedQuestion[] | null {
  const list = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.slice(0, MAXIMUM_QUESTIONS).flatMap((entry: unknown): HostedQuestion[] => {
    const question = entry as Line | null;
    const options = Array.isArray(question?.options) ? question.options : [];
    if (question === null || typeof question.question !== "string" || options.length === 0)
      return [];
    return [
      {
        question: text(question.question, MAXIMUM_QUESTION),
        header: text(question.header, MAXIMUM_HEADER),
        multiSelect: question.multiSelect === true,
        options: options.slice(0, MAXIMUM_OPTIONS).map((option: unknown) => ({
          label: text((option as Line | null)?.label, MAXIMUM_LABEL),
          description: text((option as Line | null)?.description, MAXIMUM_DESCRIPTION),
        })),
      },
    ];
  });
}

function reply(requestId: string, response: Line): string {
  return JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  });
}

/**
 * The questions Claude Code asks with `AskUserQuestion` while it runs with a stream permission
 * prompt: each one shows as a question with choices, and the person's answer goes back as the
 * tool's input. Any other tool it asks about runs, as in a session that bypasses permissions, and
 * any other request is refused, so Claude Code never waits on what the interface cannot ask.
 */
export class ClaudeQuestions {
  private readonly asked = new Map<string, unknown>();
  /** The tool calls whose questions showed with choices, so their tool lines do not repeat them. */
  private readonly shownCalls = new Set<string>();
  private replies: string[] = [];

  /** What a `control_request` line shows; its automatic answer waits in `takeReplies`. */
  request(line: Line): HostedDecodedContent | null {
    const requestId = typeof line.request_id === "string" ? line.request_id : "";
    const request = (line.request ?? null) as Line | null;
    if (requestId === "" || request === null) return null;
    if (request.subtype !== "can_use_tool") {
      this.replies.push(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "error", request_id: requestId, error: "unsupported" },
        }),
      );
      return null;
    }
    const questions = request.tool_name === "AskUserQuestion" ? questionsOf(request.input) : null;
    if (questions !== null && !IDENTIFIER.test(requestId)) {
      // A request the conversation cannot name is asked in prose instead.
      this.replies.push(reply(requestId, { behavior: "deny", message: ASK_IN_PROSE }));
      return null;
    }
    if (questions === null || questions.length === 0) {
      this.replies.push(reply(requestId, { behavior: "allow", updatedInput: request.input ?? {} }));
      return null;
    }
    this.asked.set(requestId, request.input);
    if (typeof request.tool_use_id === "string") this.shownCalls.add(request.tool_use_id);
    return {
      kind: "question",
      text: questions.map((question) => question.question).join("\n"),
      choices: { requestId, questions },
    };
  }

  /**
   * The line that answers `requestId`, and what the person said, the answers in the order they
   * were asked; null when it is not an open question.
   */
  answer(
    requestId: string,
    answers: Readonly<Record<string, string>>,
  ): { line: string; said: string } | null {
    const input = this.asked.get(requestId);
    if (input === undefined) return null;
    this.asked.delete(requestId);
    const said = (questionsOf(input) ?? [])
      .flatMap((question) => {
        const answer = answers[question.question];
        return answer === undefined ? [] : [answer];
      })
      .join("\n");
    return {
      line: reply(requestId, {
        behavior: "allow",
        updatedInput: { ...(input as object), answers },
      }),
      said,
    };
  }

  /**
   * Settles every open question when the person writes a message instead of choosing, so the
   * agent reads the message as the answer and never waits on the choices.
   */
  settleOpen(): void {
    for (const requestId of this.asked.keys())
      this.replies.push(reply(requestId, { behavior: "deny", message: REPLIED_IN_PROSE }));
    this.asked.clear();
  }

  /** Whether a question is waiting for the person. */
  waiting(): boolean {
    return this.asked.size > 0;
  }

  /** Whether the tool call `toolUseId` showed as a question with choices; it answers once. */
  showed(toolUseId: string): boolean {
    return this.shownCalls.delete(toolUseId);
  }

  /** Forgets the questions of a turn that ended, which the provider no longer waits on. */
  forget(): void {
    this.asked.clear();
    this.shownCalls.clear();
  }

  /** The automatic answers waiting to be written, as one chunk of lines. */
  takeReplies(): string {
    const lines = this.replies.map((line) => `${line}\n`).join("");
    this.replies = [];
    return lines;
  }
}
