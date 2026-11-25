import { type ApplicationCommands, type PreparedImage, RequestFailure } from "../../../ports";
import { remember, sentImages } from "../../conversation";
import { reloadWorkspaces, useWorkspaceStore } from "../../workspaces";
import { useStartStore } from "./store";

/**
 * What the start screen collects. The conversation mode is not chosen here: the core uses the
 * provider's preferred conversation, and the workspace header switches it later.
 */
export interface StartDraft {
  readonly instruction: string;
  readonly repository: string;
  /** The provider the user chose last, or empty; the core's default applies when it is unknown. */
  readonly provider: string;
}

/** A draft the core can run: an instruction and a repository. */
export function canStart(draft: StartDraft): boolean {
  return draft.instruction.trim().length > 0 && draft.repository.length > 0;
}

let starts = 0;

/**
 * Starts work: Lervo creates the worktree, branch, and workstream, and the session host launches
 * the agent with the instruction. The pending workspace shows at once, while the core works, and
 * the new workspace takes its place when it exists, with the core's notice when it started without
 * something, such as the upstream it could not fetch. A failure returns to the start screen with
 * the instruction and the failure's code and stage, unchanged. Nothing is selected if the user
 * moved on meanwhile.
 */
export async function startWork(
  commands: ApplicationCommands,
  draft: StartDraft,
  repositoryName: string,
  images: readonly PreparedImage[] = [],
): Promise<void> {
  starts += 1;
  const id = starts;
  const instruction = draft.instruction.trim();
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
      images: marks,
    },
    draft: { ...draft, instruction: "" },
    error: null,
    returnedImages: [],
  });
  try {
    // The session host takes the images out and sends them with the first message.
    const result = await commands.run("workspace.start", {
      instruction,
      repository: draft.repository,
      ...(draft.provider === "" ? {} : { provider: draft.provider }),
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
        draft: { ...store.draft, instruction },
        returnedImages: images,
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
