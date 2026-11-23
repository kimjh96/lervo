import type { ConversationItem, HostMessage } from "@lervo/session-host-contract";

import {
  ask,
  RequestFailure,
  requestId,
  type SessionHostClient,
} from "../../../platform/session-host";
import { DeltaBuffer } from "./deltas";
import { useConversationStore } from "./store";
import {
  applyAppended,
  applyDelta,
  applyPage,
  type ConversationWindow,
  emptyWindow,
  PAGE_ITEMS,
} from "./window";

/** The workspace a conversation belongs to. */
export interface ConversationTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** The instruction that started the work, shown until the session's own copy arrives. */
  readonly firstMessage?: string;
}

/** The item that stands in for the first message until the session reports it. */
const FIRST_MESSAGE_ID = "first-message";

/** Conversations whose window is kept after they close, so reopening one shows it at once. */
const RECENT_WINDOWS = 4;
const recent = new Map<string, ConversationWindow>();

function remember(sessionId: string, window: ConversationWindow): void {
  if (window.items.length === 0) return;
  recent.delete(sessionId);
  recent.set(sessionId, window);
  for (const oldest of recent.keys()) {
    if (recent.size <= RECENT_WINDOWS) break;
    recent.delete(oldest);
  }
}

/**
 * Shows one workspace's native conversation. It attaches to the session, loads the newest page,
 * and applies live items and frame-bound deltas. When the session is not running, it opens it
 * through the core, which resumes the provider's session.
 */
export class ConversationController {
  private sessionId: string;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly deltas: DeltaBuffer;

  constructor(
    private readonly client: SessionHostClient,
    private readonly target: ConversationTarget,
    nextFrame: (run: () => void) => void = (run) => requestAnimationFrame(run),
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
    const first = this.target.firstMessage;
    useConversationStore.setState({
      sessionId: null,
      window:
        first === undefined
          ? (recent.get(this.target.sessionId) ?? emptyWindow)
          : {
              items: [
                {
                  kind: "user_message",
                  itemId: FIRST_MESSAGE_ID,
                  createdAtMs: Date.now(),
                  state: "complete",
                  text: first,
                },
              ],
              hasEarlier: false,
              hasLater: false,
            },
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
    if (state.sessionId === this.sessionId) remember(this.target.sessionId, state.window);
    void this.client
      .send({ kind: "session.detach", sessionId: this.sessionId })
      .catch(() => undefined);
  }

  async send(text: string): Promise<void> {
    await ask(this.client, {
      kind: "session.send",
      requestId: requestId(),
      sessionId: this.sessionId,
      text,
    }).catch((failure: unknown) => {
      if (!(failure instanceof RequestFailure && failure.code === "request_timeout")) throw failure;
    });
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
      await this.attachAndLoad();
    } catch (failure) {
      if (!(failure instanceof RequestFailure) || failure.code !== "session_not_found") {
        useConversationStore.setState({
          error: failure instanceof RequestFailure ? failure.code : "session_open_failed",
        });
        return;
      }
      try {
        const opened = await ask(this.client, {
          kind: "session.open",
          requestId: requestId(),
          workspaceId: this.target.workspaceId,
        });
        if (opened.kind === "session.opened") this.sessionId = opened.sessionId;
        await this.attachAndLoad();
      } catch (reopening) {
        useConversationStore.setState({
          error: reopening instanceof RequestFailure ? reopening.code : "session_open_failed",
        });
      }
    }
  }

  private async attachAndLoad(): Promise<void> {
    await this.client.send({
      kind: "session.attach",
      requestId: requestId(),
      sessionId: this.sessionId,
      afterSequence: 0,
    });
    const page = await this.range("latest");
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
    const answer = await ask(this.client, {
      kind: "conversation.range",
      requestId: requestId(),
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
    const arrived = new Set(state.arrived);
    for (const item of message.items)
      if (!known.has(item.itemId) && item !== replacing) arrived.add(item.itemId);
    useConversationStore.setState({ window: applyAppended(window, message.items), arrived });
  }
}
