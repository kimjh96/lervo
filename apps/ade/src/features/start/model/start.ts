import {
  type ApplicationCommands,
  type AttachedFile,
  failureCode,
  type PreparedImage,
  RequestFailure,
} from "../../../ports";
import { remember, sentImages, withAttachedFiles } from "../../conversation/model";
import { reloadWorkspaces, useWorkspaceStore } from "../../workspaces/model";
import { useStartStore } from "./store";
import { HIRE_PRODUCT_OWNER, PRODUCT_OWNER_ROLE, showProjectAgents } from "../../agents/model";

/**
 * What the start screen collects. The conversation mode is not chosen here: the core uses the
 * provider's preferred conversation, and the workspace header switches it later.
 */
export interface StartDraft {
  readonly instruction: string;
  readonly repository: string;
  /** The provider the user chose last, or empty; the core's default applies when it is unknown. */
  readonly provider: string;
  /**
   * The agents the conversation starts with, the writing one first, when the person chose them;
   * absent, the project's default applies (Lervo ADE agents, "Participants and sessions").
   */
  readonly participants?: readonly string[];
}

/** A draft the core can run: an instruction, or attachments to go alone, and a repository. */
export function canStart(draft: StartDraft, attached = false): boolean {
  return (draft.instruction.trim().length > 0 || attached) && draft.repository.length > 0;
}

let starts = 0;

/**
 * The participants with the proposed Product Owner hired in its place (ADR-0646); it then appears
 * in the sidebar, whose list keeps its own failure. A hire that fails drops it and starts the work
 * with the others, or without an agent, rather than holding it, and keeps the core's code so the
 * conversation says what the work started without.
 */
async function withHiredOwner(
  commands: ApplicationCommands,
  projectId: string,
  chosen: readonly string[],
): Promise<{ participants: string[]; hireFailure: string | null }> {
  let hired: string | null = null;
  let hireFailure: string | null = null;
  try {
    ({
      agent: { agentId: hired },
    } = await commands.run("agent.hire", { projectId, role: PRODUCT_OWNER_ROLE }));
  } catch (failure) {
    hireFailure = failureCode(failure);
  }
  if (hired !== null) void showProjectAgents(commands, projectId);
  const participants = chosen.flatMap((id) =>
    id !== HIRE_PRODUCT_OWNER ? [id] : hired === null ? [] : [hired],
  );
  return { participants, hireFailure };
}

/**
 * Starts work: Lervo creates the worktree, branch, and workstream, and the session host launches
 * the agent with the instruction. The pending workspace shows at once, while the core works, and
 * the new workspace takes its place when it exists, with the core's notice when it started without
 * something, such as the upstream it could not fetch. A failure returns to the start screen with
 * the instruction, its images and files, and the failure's code and stage, unchanged. Files go as
 * their paths at the end of the instruction. Nothing is selected if the user moved on meanwhile.
 */
export async function startWork(
  commands: ApplicationCommands,
  draft: StartDraft,
  repositoryName: string,
  images: readonly PreparedImage[] = [],
  files: readonly AttachedFile[] = [],
): Promise<void> {
  starts += 1;
  const id = starts;
  const typed = draft.instruction.trim();
  const instruction = withAttachedFiles(
    typed,
    files.map((file) => file.path),
  );
  const current = () => useStartStore.getState().pending?.id === id;
  // The first message draws its images from the cache, under the identity the session host uses.
  // Work without images shows its pending workspace at once, without waiting a turn.
  const identities = images.length === 0 ? [] : await remember(images);
  const marks = images.map(({ mediaType, width, height }, index) => ({
    mediaType,
    width,
    height,
    ...(identities[index] === undefined ? {} : { imageId: identities[index] }),
  }));
  useStartStore.setState({
    pending: {
      id,
      instruction,
      repositoryName,
      workspaceId: null,
      baseNotice: null,
      hireFailure: null,
      images: marks,
    },
    draft: { ...draft, instruction: "" },
    error: null,
    returnedImages: [],
    returnedFiles: [],
  });
  try {
    // Only a hire waits; work with chosen agents asks the core at once.
    const chosen = draft.participants ?? [];
    const { participants, hireFailure } = chosen.includes(HIRE_PRODUCT_OWNER)
      ? await withHiredOwner(commands, draft.repository, chosen)
      : { participants: chosen, hireFailure: null };
    if (hireFailure !== null && current())
      useStartStore.setState((store) => ({
        pending: store.pending === null ? null : { ...store.pending, hireFailure },
      }));
    // The session host takes the images out and sends them with the first message.
    const result = await commands.run("workspace.start", {
      instruction,
      repository: draft.repository,
      ...(draft.provider === "" ? {} : { provider: draft.provider }),
      ...(participants.length === 0 ? {} : { participants }),
      ...(images.length === 0 ? {} : { images: sentImages(images) }),
    });
    const { workspaceId } = result;
    const notice = result.base?.notice ?? null;
    const baseNotice =
      notice === null ? null : { code: notice, upstream: result.base?.upstream ?? null };
    if (current())
      useStartStore.setState((store) => ({
        pending: store.pending === null ? null : { ...store.pending, workspaceId, baseNotice },
      }));
    await reloadWorkspaces(commands);
    if (workspaceId !== null && current()) useWorkspaceStore.getState().select(workspaceId);
  } catch (failure) {
    const stage = failure instanceof RequestFailure ? failure.parameters.stage : undefined;
    if (current())
      useStartStore.setState((store) => ({
        pending: null,
        draft: { ...store.draft, instruction: typed },
        returnedImages: images,
        returnedFiles: files,
        error: {
          code: failure instanceof RequestFailure ? failure.code : "workspace_start_failed",
          stage: typeof stage === "string" ? stage : null,
        },
      }));
  }
}

/** Forgets the pending start, when the user turns to something else. */
export function settleStart(): void {
  if (useStartStore.getState().pending !== null) useStartStore.setState({ pending: null });
}
