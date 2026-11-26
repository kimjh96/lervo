// Which core handler answers each application command of the core link.
import { advertisedCoreRequestNames, applicationCommandNames } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import type { CoreLinkHandlers } from "./core-link-handlers.js";
import type { WorkspaceOpenResult } from "./workspace-launch-service.js";
import type { RoomJoinResult } from "./workspace-room.js";
import type { WorkspaceStartResult } from "./workspace-start.js";

/** What a command that prepares a session answers: its result and the launch. */
export type Started = WorkspaceStartResult | WorkspaceOpenResult | RoomJoinResult;

/** How a command is answered: with a result, or with a result and the launch it prepared. */
export type CommandAnswer =
  | { readonly kind: "result"; readonly run: () => Promise<object> }
  | { readonly kind: "launch"; readonly run: () => Promise<Started> };

type Arguments = Record<string, unknown>;

/** An optional handler's answer, or `command_unsupported` from a core without the handler. */
function optional(
  run: ((arguments_: Arguments) => Promise<object>) | undefined,
  arguments_: Arguments,
  missing: string,
): CommandAnswer {
  return {
    kind: "result",
    run: async () => {
      if (run === undefined) throw new CommandFailure("command_unsupported", missing);
      return run(arguments_);
    },
  };
}

/** The `workspaceId` argument of a workspace command, or a failure the session host can show. */
function workspaceIdArgument(arguments_: Arguments): string {
  const value = arguments_.workspaceId;
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value)) return value;
  throw new CommandFailure("workspace_not_found", "The workspace ID is invalid.");
}

/**
 * The answer to one application command. Commands that start or join a session answer with its
 * launch; every other command answers with its result. Any command this core does not name
 * starts a workspace, as the base protocol defines.
 */
export function commandAnswer(
  handlers: CoreLinkHandlers,
  command: string,
  arguments_: Arguments,
): CommandAnswer {
  switch (command) {
    case "workspace.list":
      // The list names every command this core answers, so the session host sends a newer
      // command only to a core that knows it.
      return {
        kind: "result",
        run: async () => ({
          ...(await handlers.listWorkspaces()),
          commands: [...applicationCommandNames, ...advertisedCoreRequestNames],
        }),
      };
    case "repository.list":
      return { kind: "result", run: () => handlers.listRepositories() };
    case "provider.list":
      return { kind: "result", run: () => handlers.listProviders() };
    case "turn.summary":
      return optional(handlers.summarizeTurns, arguments_, "This core keeps no turn records.");
    case "project.add":
    case "project.rename":
    case "project.mark.set":
    case "project.mark.clear":
    case "project.mark.read":
    case "project.unregister":
    case "projects.location": {
      const run = handlers.runProjectCommand;
      return optional(
        run && ((args) => run(command, args)),
        arguments_,
        "This core manages no projects.",
      );
    }
    case "agents.list":
    case "agent.hire":
    case "agent.model":
    case "agent.rename":
    case "agent.status":
    case "agent.mark.set":
    case "agent.mark.clear":
    case "agent.mark.read": {
      const run = handlers.runAgentCommand;
      return optional(
        run && ((args) => run(command, args)),
        arguments_,
        "This core manages no agents.",
      );
    }
    case "room.join": {
      const join = handlers.joinRoom;
      return {
        kind: "launch",
        run: async () => {
          if (join === undefined)
            throw new CommandFailure("command_unsupported", "This core holds no rooms.");
          return join(arguments_);
        },
      };
    }
    case "room.route":
      return optional(handlers.routeRoom, arguments_, "This core holds no rooms.");
    case "workspace.retire":
      // An invalid ID fails this request alone, never the link.
      return {
        kind: "result",
        run: async () => handlers.retireWorkspace(workspaceIdArgument(arguments_)),
      };
    default:
      return { kind: "launch", run: () => handlers.startWorkspace(arguments_) };
  }
}
