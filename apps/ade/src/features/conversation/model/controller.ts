import type {
  ConversationItem,
  HostMessage,
  ImageMark,
  SentImage,
} from "@lervo/session-host-contract";

import { RequestFailure, type SessionHost } from "../../../ports";
import { DeltaBuffer } from "./deltas";
import { dataUrl } from "./images";
import { RecentWindows } from "./recent";
import type { ConversationSource } from "./source";
import { FIRST_MESSAGE_ID, standInWindow } from "./stand-in";
import { useConversationStore } from "./store";
import { applyAppended, applyDelta, applyPage, emptyWindow, PAGE_ITEMS } from "./window";

/** A workspace's session, whose conversation the controller shows. */
export interface SessionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** The instruction that started the work, shown until the session's own copy arrives. */
  readonly firstMessage?: string;
  /** The images pasted with that instruction, shown with it. */
  readonly firstImages?: readonly ImageMark[];
  /** Whether the session last ran in another mode, so it opens in the native conversation first. */
  readonly reopenNatively?: boolean;
}

/** The windows of conversations closed recently, shared by every controller. */
const recentWindows = new RecentWindows();

/**
 * Shows one workspace's native conversation. It attaches to the session, loads the newest page,
 * and applies live items and frame-bound deltas. When the session is not running, it opens it
 * through the core, which resumes the provider's session.
 */
export class ConversationController implements ConversationSource {
  private sessionId: string;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly deltas: DeltaBuffer;

  constructor(
    private readonly client: SessionHost,
    private readonly target: SessionTarget,
    nextFrame: (run: () => void) => void = (run) => requestAnimationFrame(run),
    private readonly recent: RecentWindows = recentWindows,
  ) {
    this.sessionId = target.sessionId;
    this.deltas = new DeltaBuffer((deltas) => {
      let window = useConversationStore.getState().window;
      for (const [itemId, text] of deltas) window = applyDelta(window, itemId, text);
      useConversationStore.setState({ window });
    }, nextFrame);
  }

  /**
   * Shows the conversation and attaches to its session. A conversation seen recently shows its
   * last window at once, and the newest page replaces it when it arrives.
   */
  async open(): Promise<void> {
    performance.mark("lervo:conversation-open");
    const first = this.target.firstMessage;
    useConversationStore.setState({
      sessionId: null,
      window:
        first === undefined
          ? (this.recent.get(this.target.sessionId) ?? emptyWindow)
          : standInWindow(first, Date.now(), this.target.firstImages),
      loadingEarlier: false,
      loadingLater: false,
      arrived: new Set(),
      error: null,
    });
    this.unsubscribe.push(this.client.onMessage((message) => this.receive(message)));
    this.unsubscribe.push(
      this.client.onState((state) => {
        if (state === "connected") void this.load();
      }),
    );
    await this.load();
  }

  close(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    const state = useConversationStore.getState();
    if (state.sessionId === this.sessionId)
      this.recent.remember(this.target.sessionId, state.window);
    void this.client
      .send({ kind: "session.detach", sessionId: this.sessionId })
      .catch(() => undefined);
  }

  /** Sends a reply; it resolves once the provider received it and rejects with the failure. */
  async send(text: string, images: readonly SentImage[] = []): Promise<void> {
    await this.client.request({
      kind: "session.send",
      sessionId: this.sessionId,
      text,
      ...(images.length === 0 ? {} : { images: [...images] }),
    });
  }

  async readImage(imageId: string): Promise<string> {
    const answer = await this.client.request({
      kind: "image.read",
      sessionId: this.sessionId,
      imageId,
    });
    if (answer.kind !== "image.data") throw new RequestFailure("answer_unexpected");
    return dataUrl(answer.mediaType, answer.data);
  }

  async interrupt(): Promise<void> {
    await this.client.request({ kind: "session.interrupt", sessionId: this.sessionId });
  }

  async loadEarlier(): Promise<void> {
    const state = useConversationStore.getState();
    const first = state.window.items[0];
    if (!state.window.hasEarlier || state.loadingEarlier || first === undefined) return;
    useConversationStore.setState({ loadingEarlier: true });
    try {
      const page = await this.range("before", first.itemId);
      useConversationStore.setState({
        window: applyPage(useConversationStore.getState().window, page, "before"),
      });
    } finally {
      useConversationStore.setState({ loadingEarlier: false });
    }
  }

  /** Loads the page after the window's last item, when the window does not reach the live end. */
  async loadLater(): Promise<void> {
    const state = useConversationStore.getState();
    const last = state.window.items.at(-1);
    if (!state.window.hasLater || state.loadingLater || last === undefined) return;
    useConversationStore.setState({ loadingLater: true });
    try {
      const page = await this.range("after", last.itemId);
      useConversationStore.setState({
        window: applyPage(useConversationStore.getState().window, page, "after"),
      });
    } finally {
      useConversationStore.setState({ loadingLater: false });
    }
  }

  /** Replaces the window with the newest page, for "Jump to latest" after reading history. */
  async showLatest(): Promise<void> {
    if (!useConversationStore.getState().window.hasLater) return;
    const page = await this.range("latest");
    useConversationStore.setState({ window: applyPage(emptyWindow, page, "latest") });
  }

  /** Attaches and loads the newest page, opening the session first when it does not run. */
  private async load(): Promise<void> {
    try {
      if (this.target.reopenNatively === true) await this.openNatively();
      await this.attachAndLoad();
    } catch (failure) {
      if (!(failure instanceof RequestFailure) || failure.code !== "session_not_found") {
        useConversationStore.setState({
          error: failure instanceof RequestFailure ? failure.code : "session_open_failed",
        });
        return;
      }
      try {
        performance.mark("lervo:conversation-not-running");
        const opened = await this.client.request({
          kind: "session.open",
          workspaceId: this.target.workspaceId,
        });
        performance.mark("lervo:conversation-opened");
        if (opened.kind === "session.opened") this.sessionId = opened.sessionId;
        await this.attachAndLoad();
      } catch (reopening) {
        useConversationStore.setState({
          error: reopening instanceof RequestFailure ? reopening.code : "session_open_failed",
        });
      }
    }
  }

  /** Opens the workspace's session in the native conversation; the core resumes the same one. */
  private async openNatively(): Promise<void> {
    const opened = await this.client.request({
      kind: "session.open",
      workspaceId: this.target.workspaceId,
      conversationMode: "native",
    });
    if (opened.kind === "session.opened") this.sessionId = opened.sessionId;
  }

  private async attachAndLoad(): Promise<void> {
    await this.client.post({ kind: "session.attach", sessionId: this.sessionId, afterSequence: 0 });
    // `lervo:` marks time each step of opening a conversation for the interface harness.
    performance.mark("lervo:conversation-attached");
    const page = await this.range("latest");
    performance.mark("lervo:conversation-page");
    const current = useConversationStore.getState().window;
    // Until the session reports the first message, the stand-in stays.
    const waiting = page.items.length === 0 && current.items[0]?.itemId === FIRST_MESSAGE_ID;
    useConversationStore.setState({
      sessionId: this.sessionId,
      window: waiting ? current : applyPage(emptyWindow, page, "latest"),
      error: null,
    });
  }

  private async range(side: "latest" | "before" | "after", anchor?: string) {
    const answer = await this.client.request({
      kind: "conversation.range",
      sessionId: this.sessionId,
      // The newest page and each earlier page both read toward the start.
      direction: side === "after" ? "after" : "before",
      limit: PAGE_ITEMS,
      ...(anchor === undefined ? {} : { anchorItemId: anchor }),
    });
    if (answer.kind !== "conversation.page") throw new RequestFailure("range_invalid");
    return answer;
  }

  private receive(message: HostMessage): void {
    if (!("sessionId" in message) || message.sessionId !== this.sessionId) return;
    // This client fell behind and the session host dropped its queue: attach and load again.
    if (message.kind === "session.resync_required") {
      void this.load();
      return;
    }
    if (message.kind === "conversation.delta") {
      this.deltas.add(message.itemId, message.append);
      return;
    }
    if (message.kind !== "conversation.appended") return;
    this.deltas.release();
    const state = useConversationStore.getState();
    // The session's copy of the first message replaces the stand-in in place, without arriving.
    const standIn = state.window.items.find((item) => item.itemId === FIRST_MESSAGE_ID);
    const replacing =
      standIn !== undefined &&
      "text" in standIn &&
      message.items.find((item) => item.kind === "user_message" && item.text === standIn.text);
    const window = replacing
      ? {
          ...state.window,
          items: state.window.items.filter((item) => item.itemId !== FIRST_MESSAGE_ID),
        }
      : state.window;
    const known = new Set(window.items.map((item: ConversationItem) => item.itemId));
    const next = applyAppended(window, message.items);
    // Only items still in the window can animate, so the set stays within the window's bound.
    const kept = new Set(next.items.map((item) => item.itemId));
    const arrived = new Set([...state.arrived].filter((itemId) => kept.has(itemId)));
    for (const item of message.items)
      if (!known.has(item.itemId) && item !== replacing && kept.has(item.itemId))
        arrived.add(item.itemId);
    useConversationStore.setState({ window: next, arrived });
  }
}
