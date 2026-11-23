import type { SessionHostClient } from "./client";
import { RequestFailure } from "./requests";

/** Application commands do core work, such as creating a worktree, so they may take long. */
const DEADLINE_MS = 130_000;

/** Runs Lervo application commands through the session host and returns their results. */
export class ApplicationCommands {
  constructor(private readonly client: SessionHostClient) {}

  async run(
    command: string,
    arguments_: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const answer = await this.client.request(
      { kind: "application.command", command, arguments: arguments_ },
      DEADLINE_MS,
    );
    if (answer.kind !== "application.result") throw new RequestFailure("answer_unexpected");
    return answer.result;
  }
}
