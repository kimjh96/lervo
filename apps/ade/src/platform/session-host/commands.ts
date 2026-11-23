import type { ApplicationCommandName, ApplicationResults } from "@lervo/session-host-contract";

import { type ApplicationCommands, RequestFailure } from "../../ports/session-host";
import type { SessionHostClient } from "./client";

/** Application commands do core work, such as creating a worktree, so they may take long. */
const DEADLINE_MS = 130_000;

/** Runs Lervo application commands through the session host and returns their results. */
export class SessionHostCommands implements ApplicationCommands {
  constructor(private readonly client: SessionHostClient) {}

  async run<C extends ApplicationCommandName>(
    command: C,
    arguments_: Record<string, unknown> = {},
  ): Promise<ApplicationResults[C]> {
    const answer = await this.client.request(
      { kind: "application.command", command, arguments: arguments_ },
      DEADLINE_MS,
    );
    if (answer.kind !== "application.result") throw new RequestFailure("answer_unexpected");
    // The session host forwards only results that match the command's schema.
    return answer.result as ApplicationResults[C];
  }
}
